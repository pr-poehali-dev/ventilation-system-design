// ПВ-Система Desktop — Tauri main.rs
// Запускает Python-сервер как sidecar, затем открывает WebView с фронтендом.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn get_server_url() -> String {
    "http://127.0.0.1:54321".to_string()
}

fn wait_for_server(url: &str, timeout_secs: u64) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed().as_secs() < timeout_secs {
        if reqwest::blocking::get(url).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let shell = app.shell();
            // Запускаем Python-сервер как sidecar
            let _child = shell
                .sidecar("python-server")
                .expect("Не удалось найти python-server sidecar")
                .spawn()
                .expect("Не удалось запустить python-server");

            // Ждём готовности сервера (до 15 сек)
            let ready = wait_for_server("http://127.0.0.1:54321/health", 15);
            if !ready {
                eprintln!("[tauri] ПРЕДУПРЕЖДЕНИЕ: сервер не ответил за 15 сек");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_server_url])
        .run(tauri::generate_context!())
        .expect("Ошибка запуска приложения");
}
