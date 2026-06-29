// ПВ-Система Desktop
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{Duration, Instant};
use std::path::PathBuf;

#[tauri::command]
fn get_server_url() -> String {
    "http://127.0.0.1:54321".to_string()
}

fn get_server_path() -> PathBuf {
    // Ищем python-server.exe рядом с основным .exe
    let exe = std::env::current_exe().unwrap();
    let dir = exe.parent().unwrap();
    // Пробуем оба варианта имени
    let with_triple = dir.join("python-server-x86_64-pc-windows-msvc.exe");
    if with_triple.exists() {
        return with_triple;
    }
    dir.join("python-server.exe")
}

fn start_server() {
    let path = get_server_path();
    if !path.exists() {
        eprintln!("[tauri] python-server не найден: {:?}", path);
        return;
    }
    std::process::Command::new(&path)
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("[tauri] Не удалось запустить сервер: {}", e);
            panic!("server start failed");
        });
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
    // Запускаем сервер ДО инициализации Tauri
    start_server();

    // Ждём готовности сервера (до 15 сек)
    let ready = wait_for_server("http://127.0.0.1:54321/health", 15);
    if !ready {
        eprintln!("[tauri] Сервер не ответил за 15 сек — продолжаем");
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_server_url])
        .run(tauri::generate_context!())
        .expect("Ошибка запуска приложения");
}
