// ПВ-Система Desktop — Tauri entry point
// Запускает Python-сервер как sidecar, ждёт готовности, открывает окно.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{Duration, Instant};
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn get_server_url() -> String {
    "http://127.0.0.1:54321".to_string()
}

fn wait_for_server(url: &str, timeout_secs: u64) -> bool {
    let start = Instant::now();
    while start.elapsed().as_secs() < timeout_secs {
        if reqwest::blocking::get(url).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    false
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Запускаем Python-сервер как sidecar-процесс
            let shell = app.shell();
            shell
                .sidecar("python-server")
                .expect("python-server sidecar не найден")
                .spawn()
                .expect("Не удалось запустить python-server");

            // Ждём готовности в отдельном потоке чтобы не блокировать UI
            std::thread::spawn(|| {
                let ready = wait_for_server("http://127.0.0.1:54321/health", 20);
                if !ready {
                    eprintln!("[tauri] Сервер не ответил за 20 сек");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_server_url])
        .run(tauri::generate_context!())
        .expect("Ошибка запуска приложения");
}
