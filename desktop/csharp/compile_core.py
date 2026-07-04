"""
Компиляция расчётного ядра в байткод (.pyc) — бесплатная защита от чтения кода.

Зачем: если упаковать обычные .py в server.exe, любой сможет их распаковать и
прочитать формулы расчётов (аэродинамика, взрыв). Мы вместо этого компилируем
все модули в .pyc и кладём ТОЛЬКО их — исходники .py в сборку не попадают.
После распаковки видно лишь байткод, что заметно усложняет кражу логики.

Использование:
    python compile_core.py <src_dir> <out_dir>

Результат: копия структуры src_dir в out_dir, где каждый foo.py заменён на
foo.pyc (legacy-имя, лежит рядом), а .py удалены.
"""
import os
import sys
import shutil
import py_compile


def main():
    if len(sys.argv) != 3:
        print("Usage: python compile_core.py <src_dir> <out_dir>")
        sys.exit(1)

    src = os.path.abspath(sys.argv[1])
    out = os.path.abspath(sys.argv[2])

    if not os.path.isdir(src):
        print(f"ERROR: source dir not found: {src}")
        sys.exit(1)

    if os.path.exists(out):
        shutil.rmtree(out)

    compiled = 0
    copied = 0
    for root, dirs, files in os.walk(src):
        # пропускаем кэш-папки
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        rel = os.path.relpath(root, src)
        dst_root = out if rel == "." else os.path.join(out, rel)
        os.makedirs(dst_root, exist_ok=True)

        for name in files:
            src_file = os.path.join(root, name)
            if name.endswith(".py"):
                # компилируем .py -> foo.pyc рядом (legacy-имя, без __pycache__)
                dst_pyc = os.path.join(dst_root, name[:-3] + ".pyc")
                py_compile.compile(
                    src_file, cfile=dst_pyc, doraise=True, optimize=2,
                )
                compiled += 1
            elif name.endswith(".pyc"):
                # уже скомпилированные — пропускаем
                continue
            else:
                # прочие ресурсы (html/js/css/json и т.п.) копируем как есть
                shutil.copy2(src_file, os.path.join(dst_root, name))
                copied += 1

    print(f"Compiled {compiled} .py -> .pyc, copied {copied} resource files")
    print(f"Protected core: {out}")

    # sanity check: server.pyc должен существовать (точка входа импортирует server)
    if not os.path.exists(os.path.join(out, "server.pyc")):
        print("ERROR: server.pyc not produced")
        sys.exit(1)


if __name__ == "__main__":
    main()
