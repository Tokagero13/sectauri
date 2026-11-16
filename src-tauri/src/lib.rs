mod audit;
mod auth;
mod commands;
mod state;
mod vault;

use state::{AppState, AuthState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(AuthState::default())
        .invoke_handler(tauri::generate_handler![
            auth::auth_status,
            auth::auth_setup,
            auth::auth_login,
            auth::auth_verify_totp,
            auth::auth_lock,
            auth::auth_change_password,
            auth::totp_begin_setup,
            auth::totp_confirm_setup,
            auth::totp_disable,
            auth::forget_device,
            audit::audit_log,
            commands::open_vault,
            commands::create_vault,
            commands::lock_vault,
            commands::close_vault_if_saved,
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
            commands::move_group,
            commands::set_group_color,
            commands::copy_field,
            commands::copy_text,
            commands::save_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
