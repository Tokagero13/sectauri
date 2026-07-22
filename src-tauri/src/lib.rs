mod commands;
mod state;
mod vault;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_vault,
            commands::create_vault,
            commands::lock_vault,
            commands::is_unlocked,
            commands::get_tree,
            commands::get_entry,
            commands::create_entry,
            commands::update_entry,
            commands::delete_entry,
            commands::move_entry,
            commands::create_group,
            commands::rename_group,
            commands::delete_group,
            commands::save_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
