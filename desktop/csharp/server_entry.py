"""
ПВС-Система — точка входа Flask-сервера для C#-обёртки.
Запускается как server.exe, диалоги сохранения файлов — через C# (не tkinter).
"""
import os
import sys

def resource(path):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, path)

sys.path.insert(0, resource("pvs-core"))

from server import app

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5173, threaded=True, debug=False, use_reloader=False)
