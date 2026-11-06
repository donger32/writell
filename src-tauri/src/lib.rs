#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // remembers folders you picked (e.g. a backup folder on another drive) across restarts
        .plugin(tauri_plugin_persisted_scope::init())
        // "Writell X is available: Update now" (downloads from GitHub Releases, checks the signature)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running Writell");
}
