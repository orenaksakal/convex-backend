use std::{
    collections::{
        HashMap,
        HashSet,
    },
    fs::{
        self,
        OpenOptions,
    },
    io::Write,
    path::{
        Path,
        PathBuf,
    },
    time::{
        Duration,
        SystemTime,
        UNIX_EPOCH,
    },
};

use async_trait::async_trait;
use base64::{
    decode_config,
    encode_config,
    URL_SAFE_NO_PAD,
};
use common::{
    knobs::ADMIN_IDENTITY_EXPIRATION_DELAY,
    types::MemberId,
};
use errors::ErrorMetadata;
use keybroker::{
    AdminIdentity,
    AdminIdentityPrincipal,
    DeploymentOp,
    Identity,
};
use parking_lot::Mutex;
use serde::{
    Deserialize,
    Serialize,
};
use sha2::{
    Digest,
    Sha256,
};

use crate::access_token_auth::AccessTokenAuth;

const DASHBOARD_AUDIENCE: &str = "convex-self-hosted-dashboard";
const DEPLOY_AUDIENCE: &str = "convex-self-hosted-deploy";
const MAX_TOKEN_BYTES: usize = 8 * 1024;
const MIN_TTL: Duration = Duration::from_secs(60);
const MAX_DASHBOARD_TTL: Duration = Duration::from_secs(600);
const MAX_DEPLOY_TTL: Duration = Duration::from_secs(366 * 86_400);
const MAX_CLOCK_SKEW: Duration = Duration::from_secs(30);
const MAX_DEPLOY_CREDENTIALS: usize = 64;
const USAGE_WRITE_INTERVAL: Duration = Duration::from_secs(60);

pub struct DashboardAccessTokenAuth {
    instance_name: String,
    secrets: Vec<[u8; 32]>,
    deploy_credentials: Option<DeployCredentialFiles>,
}

struct DeployCredentialFiles {
    registry_path: PathBuf,
    usage_path: PathBuf,
    last_used_at: Mutex<HashMap<String, u64>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DashboardTokenPayload {
    audience: String,
    instance_id: String,
    subject: String,
    issued_at: u64,
    expires_at: u64,
    nonce: String,
    allowed_ops: Vec<DeploymentOp>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeployCredentialRegistry {
    schema_version: u64,
    instance_id: String,
    credentials: Vec<DeployCredentialEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeployCredentialEntry {
    id: String,
    label: String,
    created_at: u64,
    expires_at: u64,
    revoked_at: Option<u64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeployCredentialUsage {
    schema_version: u64,
    instance_id: String,
    last_used_at: HashMap<String, u64>,
}

impl DashboardAccessTokenAuth {
    pub fn new(instance_name: String, encoded_secret: &str) -> anyhow::Result<Self> {
        let encoded_secrets: Vec<_> = encoded_secret.split(',').collect();
        anyhow::ensure!(
            (1..=2).contains(&encoded_secrets.len()),
            "dashboard token secret set must contain one or two keys"
        );
        let mut secrets = Vec::with_capacity(encoded_secrets.len());
        for encoded in encoded_secrets {
            anyhow::ensure!(
                !encoded.is_empty() && encoded.trim() == encoded,
                "dashboard token secret set contains an empty or padded key"
            );
            let decoded = decode_canonical(encoded)?;
            let secret: [u8; 32] = decoded.try_into().map_err(|_| {
                anyhow::anyhow!("dashboard token secret must decode to exactly 32 bytes")
            })?;
            anyhow::ensure!(
                !secrets.contains(&secret),
                "dashboard token secret set contains a duplicate key"
            );
            secrets.push(secret);
        }
        Ok(Self {
            instance_name,
            secrets,
            deploy_credentials: None,
        })
    }

    pub fn new_with_deploy_credentials(
        instance_name: String,
        encoded_secret: &str,
        registry_path: PathBuf,
        usage_path: PathBuf,
    ) -> anyhow::Result<Self> {
        anyhow::ensure!(
            registry_path.is_absolute(),
            "deploy credential registry path must be absolute"
        );
        anyhow::ensure!(
            usage_path.is_absolute(),
            "deploy credential usage path must be absolute"
        );
        let mut auth = Self::new(instance_name.clone(), encoded_secret)?;
        let usage = match fs::read(&usage_path) {
            Ok(bytes) => parse_usage(&bytes, &instance_name)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => DeployCredentialUsage {
                schema_version: 1,
                instance_id: instance_name,
                last_used_at: HashMap::new(),
            },
            Err(error) => return Err(error.into()),
        };
        auth.deploy_credentials = Some(DeployCredentialFiles {
            registry_path,
            usage_path,
            last_used_at: Mutex::new(usage.last_used_at),
        });
        Ok(auth)
    }

    fn authorize_at(&self, token: &str, now: SystemTime) -> anyhow::Result<Identity> {
        self.verify(token, now).map_err(|error| {
            error.context(ErrorMetadata::unauthenticated(
                "BadSelfHostedAccessCredential",
                "The self-hosted access credential is invalid or expired",
            ))
        })
    }

    fn verify(&self, token: &str, now: SystemTime) -> anyhow::Result<Identity> {
        anyhow::ensure!(
            token.len() <= MAX_TOKEN_BYTES,
            "self-hosted access token is too large"
        );
        let mut parts = token.split('.');
        let version = parts.next().unwrap_or_default();
        let payload_part = parts.next().unwrap_or_default();
        let signature_part = parts.next().unwrap_or_default();
        anyhow::ensure!(
            parts.next().is_none() && version == "v1",
            "invalid token format"
        );

        let signed = format!("{version}.{payload_part}");
        let actual_signature = decode_canonical(signature_part)?;
        let signature_matches = self
            .secrets
            .iter()
            .map(|secret| hmac_sha256(secret, signed.as_bytes()))
            .fold(false, |matched, expected_signature| {
                constant_time_equal(&actual_signature, &expected_signature) | matched
            });
        anyhow::ensure!(
            signature_matches,
            "invalid self-hosted access token signature"
        );

        let payload_bytes = decode_canonical(payload_part)?;
        let payload: DashboardTokenPayload = serde_json::from_slice(&payload_bytes)?;
        anyhow::ensure!(
            payload.audience == DASHBOARD_AUDIENCE || payload.audience == DEPLOY_AUDIENCE,
            "invalid self-hosted access token audience"
        );
        anyhow::ensure!(
            payload.instance_id == self.instance_name,
            "self-hosted access token is for another instance"
        );
        anyhow::ensure!(
            valid_identifier(&payload.subject),
            "invalid self-hosted access token subject"
        );
        let nonce = decode_canonical(&payload.nonce)?;
        anyhow::ensure!(nonce.len() == 16, "invalid self-hosted access token nonce");

        let issued_at = UNIX_EPOCH + Duration::from_secs(payload.issued_at);
        let expires_at = UNIX_EPOCH + Duration::from_secs(payload.expires_at);
        let ttl = expires_at.duration_since(issued_at).map_err(|_| {
            anyhow::anyhow!("self-hosted access token expiration precedes issuance")
        })?;
        let max_ttl = if payload.audience == DEPLOY_AUDIENCE {
            MAX_DEPLOY_TTL
        } else {
            MAX_DASHBOARD_TTL
        };
        anyhow::ensure!(
            ttl >= MIN_TTL && ttl <= max_ttl,
            "invalid self-hosted access token TTL"
        );
        anyhow::ensure!(
            issued_at <= now + MAX_CLOCK_SKEW,
            "self-hosted access token was issued in the future"
        );
        anyhow::ensure!(now < expires_at, "self-hosted access token expired");
        let identity_validated_at = expires_at
            .checked_sub(*ADMIN_IDENTITY_EXPIRATION_DELAY + Duration::from_secs(1))
            .ok_or_else(|| {
                anyhow::anyhow!("self-hosted access token expiration is out of range")
            })?;

        anyhow::ensure!(
            !payload.allowed_ops.is_empty(),
            "self-hosted access token operations are empty"
        );
        anyhow::ensure!(
            !payload.allowed_ops.contains(&DeploymentOp::Unknown),
            "self-hosted access token contains an unknown operation"
        );
        let unique: HashSet<_> = payload.allowed_ops.iter().copied().collect();
        anyhow::ensure!(
            unique.len() == payload.allowed_ops.len(),
            "self-hosted access token contains duplicate operations"
        );

        if payload.audience == DEPLOY_AUDIENCE {
            anyhow::ensure!(
                payload.allowed_ops == [DeploymentOp::Deploy],
                "deploy credential must allow only Deploy"
            );
            self.validate_and_record_deploy_credential(&payload, now)?;
        }

        Ok(Identity::DeploymentAdmin(
            AdminIdentity::new_for_access_token(
                self.instance_name.clone(),
                AdminIdentityPrincipal::Member(MemberId(0)),
                token.to_owned(),
                false,
                payload.allowed_ops,
                identity_validated_at,
                None,
                Some(payload.audience),
            ),
        ))
    }

    fn validate_and_record_deploy_credential(
        &self,
        payload: &DashboardTokenPayload,
        now: SystemTime,
    ) -> anyhow::Result<()> {
        let files = self
            .deploy_credentials
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("deploy credential support is not configured"))?;
        anyhow::ensure!(
            valid_deploy_credential_id(&payload.subject),
            "invalid deploy credential ID"
        );
        let registry_bytes = fs::read(&files.registry_path)?;
        let registry = parse_registry(&registry_bytes, &self.instance_name)?;
        let credential = registry
            .credentials
            .iter()
            .find(|credential| credential.id == payload.subject)
            .ok_or_else(|| anyhow::anyhow!("deploy credential is not registered"))?;
        anyhow::ensure!(
            credential.revoked_at.is_none(),
            "deploy credential is revoked"
        );
        anyhow::ensure!(
            credential.expires_at == payload.expires_at,
            "deploy credential expiry does not match registry"
        );
        let now_epoch = now.duration_since(UNIX_EPOCH)?.as_secs();
        anyhow::ensure!(
            credential.expires_at > now_epoch,
            "deploy credential expired"
        );
        record_usage(files, &self.instance_name, &payload.subject, now_epoch)
    }
}

fn parse_registry(bytes: &[u8], instance_name: &str) -> anyhow::Result<DeployCredentialRegistry> {
    let registry: DeployCredentialRegistry = serde_json::from_slice(bytes)?;
    anyhow::ensure!(
        registry.schema_version == 1,
        "unsupported deploy credential registry schema"
    );
    anyhow::ensure!(
        registry.instance_id == instance_name,
        "deploy credential registry is for another instance"
    );
    anyhow::ensure!(
        registry.credentials.len() <= MAX_DEPLOY_CREDENTIALS,
        "deploy credential registry is too large"
    );
    let mut ids = HashSet::new();
    for credential in &registry.credentials {
        anyhow::ensure!(
            valid_deploy_credential_id(&credential.id),
            "invalid deploy credential registry ID"
        );
        anyhow::ensure!(
            !credential.label.is_empty()
                && credential.label.len() <= 64
                && credential.label.trim() == credential.label,
            "invalid deploy credential label"
        );
        anyhow::ensure!(
            credential.expires_at > credential.created_at,
            "invalid deploy credential lifetime"
        );
        anyhow::ensure!(
            ids.insert(&credential.id),
            "duplicate deploy credential registry ID"
        );
    }
    Ok(registry)
}

fn parse_usage(bytes: &[u8], instance_name: &str) -> anyhow::Result<DeployCredentialUsage> {
    let usage: DeployCredentialUsage = serde_json::from_slice(bytes)?;
    anyhow::ensure!(
        usage.schema_version == 1,
        "unsupported deploy credential usage schema"
    );
    anyhow::ensure!(
        usage.instance_id == instance_name,
        "deploy credential usage is for another instance"
    );
    anyhow::ensure!(
        usage.last_used_at.len() <= MAX_DEPLOY_CREDENTIALS,
        "deploy credential usage is too large"
    );
    anyhow::ensure!(
        usage
            .last_used_at
            .keys()
            .all(|id| valid_deploy_credential_id(id)),
        "invalid deploy credential usage ID"
    );
    Ok(usage)
}

fn record_usage(
    files: &DeployCredentialFiles,
    instance_name: &str,
    credential_id: &str,
    now_epoch: u64,
) -> anyhow::Result<()> {
    let mut last_used_at = files.last_used_at.lock();
    if last_used_at
        .get(credential_id)
        .is_some_and(|last| now_epoch.saturating_sub(*last) < USAGE_WRITE_INTERVAL.as_secs())
    {
        return Ok(());
    }
    anyhow::ensure!(
        last_used_at.contains_key(credential_id) || last_used_at.len() < MAX_DEPLOY_CREDENTIALS,
        "deploy credential usage registry is full"
    );
    let previous = last_used_at.insert(credential_id.to_owned(), now_epoch);
    let usage = DeployCredentialUsage {
        schema_version: 1,
        instance_id: instance_name.to_owned(),
        last_used_at: last_used_at.clone(),
    };
    if let Err(error) = write_usage_atomic(&files.usage_path, &usage) {
        if let Some(previous) = previous {
            last_used_at.insert(credential_id.to_owned(), previous);
        } else {
            last_used_at.remove(credential_id);
        }
        return Err(error);
    }
    Ok(())
}

fn write_usage_atomic(path: &Path, usage: &DeployCredentialUsage) -> anyhow::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("deploy credential usage path has no parent"))?;
    let temporary = parent.join(format!(
        ".deploy-credential-usage-{}-{}.tmp",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    ));
    let result = (|| -> anyhow::Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o660);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&serde_json::to_vec_pretty(usage)?)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[async_trait]
impl AccessTokenAuth for DashboardAccessTokenAuth {
    async fn is_authorized(&self, access_token: &str) -> anyhow::Result<Identity> {
        self.authorize_at(access_token, SystemTime::now())
    }
}

fn decode_canonical(value: &str) -> anyhow::Result<Vec<u8>> {
    let decoded = decode_config(value, URL_SAFE_NO_PAD)?;
    anyhow::ensure!(
        encode_config(&decoded, URL_SAFE_NO_PAD) == value,
        "non-canonical base64url encoding"
    );
    Ok(decoded)
}

fn hmac_sha256(key: &[u8; 32], message: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut inner_pad = [0x36; BLOCK_SIZE];
    let mut outer_pad = [0x5c; BLOCK_SIZE];
    for (index, byte) in key.iter().enumerate() {
        inner_pad[index] ^= byte;
        outer_pad[index] ^= byte;
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_hash);
    outer.finalize().into()
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.contains('\0')
}

fn valid_deploy_credential_id(value: &str) -> bool {
    value.len() == 39
        && value.starts_with("deploy_")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const SECRET: &str = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
    const VALID_TOKEN: &str = "v1.eyJhdWRpZW5jZSI6ImNvbnZleC1zZWxmLWhvc3RlZC1kYXNoYm9hcmQiLCJpbnN0YW5jZUlkIjoiYXBwLW9uZSIsInN1YmplY3QiOiJzZXNzaW9uLW9uZSIsImlzc3VlZEF0IjoxNzU0Mzk1MjAwLCJleHBpcmVzQXQiOjE3NTQzOTU1MDAsIm5vbmNlIjoiQ3dzTEN3c0xDd3NMQ3dzTEN3c0xDdyIsImFsbG93ZWRPcHMiOlsiVmlld0RhdGEiLCJSdW5JbnRlcm5hbFF1ZXJpZXMiXX0.20T9LakX8cv5mf4DKuVeNkW_ZyOavqexdR-E1Tuc-vE";

    #[test]
    fn validates_node_compatible_short_lived_token() -> anyhow::Result<()> {
        let auth = DashboardAccessTokenAuth::new("app-one".to_owned(), SECRET)?;
        let now = UNIX_EPOCH + Duration::from_secs(1_754_395_250);
        let identity = auth.authorize_at(VALID_TOKEN, now)?;
        let Identity::DeploymentAdmin(identity) = identity else {
            anyhow::bail!("expected deployment admin identity");
        };
        assert!(!identity.is_read_only());
        Ok(())
    }

    #[test]
    fn rejects_expired_wrong_instance_and_noncanonical_tokens() -> anyhow::Result<()> {
        let auth = DashboardAccessTokenAuth::new("app-one".to_owned(), SECRET)?;
        assert!(auth
            .authorize_at(VALID_TOKEN, UNIX_EPOCH + Duration::from_secs(1_754_395_500),)
            .is_err());
        let other = DashboardAccessTokenAuth::new("app-two".to_owned(), SECRET)?;
        assert!(other
            .authorize_at(VALID_TOKEN, UNIX_EPOCH + Duration::from_secs(1_754_395_250),)
            .is_err());
        let mut tampered = VALID_TOKEN.to_owned();
        tampered.pop();
        tampered.push('R');
        assert!(auth
            .authorize_at(&tampered, UNIX_EPOCH + Duration::from_secs(1_754_395_250),)
            .is_err());
        Ok(())
    }

    #[test]
    fn accepts_a_bounded_rotation_overlap_and_rejects_duplicate_keys() -> anyhow::Result<()> {
        let replacement = "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";
        let auth = DashboardAccessTokenAuth::new(
            "app-one".to_owned(),
            &format!("{replacement},{SECRET}"),
        )?;
        assert!(auth
            .authorize_at(VALID_TOKEN, UNIX_EPOCH + Duration::from_secs(1_754_395_250),)
            .is_ok());
        assert!(
            DashboardAccessTokenAuth::new("app-one".to_owned(), &format!("{SECRET},{SECRET}"),)
                .is_err()
        );
        assert!(DashboardAccessTokenAuth::new(
            "app-one".to_owned(),
            &format!("{SECRET},{replacement},{SECRET}"),
        )
        .is_err());
        Ok(())
    }

    #[test]
    fn validates_registered_deploy_credentials_and_records_last_use() -> anyhow::Result<()> {
        let directory = tempfile::tempdir()?;
        let registry_path = directory.path().join("deploy-credentials.json");
        let usage_path = directory.path().join("deploy-credential-usage.json");
        let issued_at = 1_754_395_200;
        let expires_at = issued_at + 86_400;
        let credential_id = "deploy_0123456789abcdef0123456789abcdef";
        fs::write(
            &registry_path,
            serde_json::to_vec(&json!({
                "schemaVersion": 1,
                "instanceId": "app-one",
                "credentials": [{
                    "id": credential_id,
                    "label": "Production CI",
                    "createdAt": issued_at,
                    "expiresAt": expires_at,
                    "revokedAt": null
                }]
            }))?,
        )?;
        let auth = DashboardAccessTokenAuth::new_with_deploy_credentials(
            "app-one".to_owned(),
            SECRET,
            registry_path.clone(),
            usage_path.clone(),
        )?;
        let token = issue_test_token(
            DEPLOY_AUDIENCE,
            credential_id,
            issued_at,
            expires_at,
            &["Deploy"],
        )?;
        let now = UNIX_EPOCH + Duration::from_secs(issued_at + 30);
        let identity = auth.authorize_at(&token, now)?;
        let Identity::DeploymentAdmin(identity) = identity else {
            anyhow::bail!("expected deployment admin identity");
        };
        assert!(!identity.is_read_only());
        let usage = parse_usage(&fs::read(&usage_path)?, "app-one")?;
        assert_eq!(
            usage.last_used_at.get(credential_id),
            Some(&(issued_at + 30))
        );

        let wrong_scope = issue_test_token(
            DEPLOY_AUDIENCE,
            credential_id,
            issued_at,
            expires_at,
            &["Deploy", "ViewData"],
        )?;
        assert!(auth.authorize_at(&wrong_scope, now).is_err());

        let revoked = json!({
            "schemaVersion": 1,
            "instanceId": "app-one",
            "credentials": [{
                "id": credential_id,
                "label": "Production CI",
                "createdAt": issued_at,
                "expiresAt": expires_at,
                "revokedAt": issued_at + 31
            }]
        });
        fs::write(&registry_path, serde_json::to_vec(&revoked)?)?;
        assert!(auth.authorize_at(&token, now).is_err());
        Ok(())
    }

    #[test]
    fn deploy_credentials_fail_closed_when_usage_evidence_cannot_be_written() -> anyhow::Result<()>
    {
        let directory = tempfile::tempdir()?;
        let registry_path = directory.path().join("deploy-credentials.json");
        let usage_path = directory.path().join("missing").join("usage.json");
        let issued_at = 1_754_395_200;
        let expires_at = issued_at + 86_400;
        let credential_id = "deploy_fedcba9876543210fedcba9876543210";
        fs::write(
            &registry_path,
            serde_json::to_vec(&json!({
                "schemaVersion": 1,
                "instanceId": "app-one",
                "credentials": [{
                    "id": credential_id,
                    "label": "Release",
                    "createdAt": issued_at,
                    "expiresAt": expires_at,
                    "revokedAt": null
                }]
            }))?,
        )?;
        let auth = DashboardAccessTokenAuth::new_with_deploy_credentials(
            "app-one".to_owned(),
            SECRET,
            registry_path,
            usage_path,
        )?;
        let token = issue_test_token(
            DEPLOY_AUDIENCE,
            credential_id,
            issued_at,
            expires_at,
            &["Deploy"],
        )?;
        assert!(auth
            .authorize_at(&token, UNIX_EPOCH + Duration::from_secs(issued_at + 30),)
            .is_err());
        Ok(())
    }

    fn issue_test_token(
        audience: &str,
        subject: &str,
        issued_at: u64,
        expires_at: u64,
        allowed_ops: &[&str],
    ) -> anyhow::Result<String> {
        let payload = json!({
            "audience": audience,
            "instanceId": "app-one",
            "subject": subject,
            "issuedAt": issued_at,
            "expiresAt": expires_at,
            "nonce": encode_config([11_u8; 16], URL_SAFE_NO_PAD),
            "allowedOps": allowed_ops,
        });
        let encoded = encode_config(serde_json::to_vec(&payload)?, URL_SAFE_NO_PAD);
        let signed = format!("v1.{encoded}");
        let secret: [u8; 32] = decode_canonical(SECRET)?.try_into().unwrap();
        let signature = encode_config(hmac_sha256(&secret, signed.as_bytes()), URL_SAFE_NO_PAD);
        Ok(format!("{signed}.{signature}"))
    }
}
