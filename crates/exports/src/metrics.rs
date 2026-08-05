use metrics::{
    register_convex_gauge,
    register_convex_histogram,
    StaticMetricLabel,
    StatusTimer,
};

register_convex_histogram!(
    SNAPSHOT_EXPORT_TIMER_SECONDS,
    "Time taken for a snapshot export",
    &["instance_name", "status"]
);
pub fn export_timer(instance_name: &str) -> StatusTimer {
    let mut timer = StatusTimer::new(&SNAPSHOT_EXPORT_TIMER_SECONDS);
    timer.add_label(StaticMetricLabel::new(
        "instance_name",
        instance_name.to_owned(),
    ));
    timer
}

register_convex_gauge!(
    SNAPSHOT_EXPORT_STORAGE_TABLETS_REGISTERED_TOTAL,
    "Storage tablets retained by active snapshot exports"
);
register_convex_gauge!(
    SNAPSHOT_EXPORT_PREFETCHED_FILES_TOTAL,
    "Storage files currently retained by snapshot export prefetch"
);
register_convex_gauge!(
    SNAPSHOT_EXPORT_PREFETCHED_BYTES,
    "Storage bytes currently retained by snapshot export prefetch"
);

pub fn storage_tablet_registered() {
    SNAPSHOT_EXPORT_STORAGE_TABLETS_REGISTERED_TOTAL.inc();
}

pub fn storage_tablet_unregistered() {
    SNAPSHOT_EXPORT_STORAGE_TABLETS_REGISTERED_TOTAL.dec();
}

pub fn storage_file_prefetched(bytes: usize) {
    SNAPSHOT_EXPORT_PREFETCHED_FILES_TOTAL.inc();
    SNAPSHOT_EXPORT_PREFETCHED_BYTES.add(bytes as f64);
}

pub fn storage_file_released(bytes: usize) {
    SNAPSHOT_EXPORT_PREFETCHED_FILES_TOTAL.dec();
    SNAPSHOT_EXPORT_PREFETCHED_BYTES.sub(bytes as f64);
}
