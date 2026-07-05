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

    # Папки, которые пропускаем при обходе: кэш и сборочные артефакты.
    SKIP_DIRS = {"__pycache__", "build", "pvs-core-pyc", ".git"}
    # dist (собранный фронтенд) НЕ компилируем — там нет .py, только html/js/css.
    # backend_functions копируем как есть (.py): их handler'ы грузятся динамически
    # через spec_from_file_location и зависят от numpy. Компиляция в .pyc и
    # загрузка через SourcelessFileLoader на них ломала импорт (airflow => 500).
    COPY_WHOLE = {"dist", "backend_functions"}

    compiled = 0
    copied = 0
    errors = 0
    for root, dirs, files in os.walk(src):
        # dist копируем целиком отдельно и не заходим внутрь при обходе
        for d in list(dirs):
            if d in COPY_WHOLE:
                shutil.copytree(
                    os.path.join(root, d),
                    os.path.join(out, os.path.relpath(os.path.join(root, d), src)),
                    dirs_exist_ok=True,
                )
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and d not in COPY_WHOLE]
        rel = os.path.relpath(root, src)
        dst_root = out if rel == "." else os.path.join(out, rel)
        os.makedirs(dst_root, exist_ok=True)

        for name in files:
            src_file = os.path.join(root, name)
            if name.endswith(".py"):
                # компилируем .py -> foo.pyc рядом (legacy-имя, без __pycache__).
                # optimize=0 (по умолчанию), иначе рантайм отвергнет .pyc.
                dst_pyc = os.path.join(dst_root, name[:-3] + ".pyc")
                try:
                    py_compile.compile(src_file, cfile=dst_pyc, doraise=True)
                    compiled += 1
                except py_compile.PyCompileError as e:
                    # один битый файл не должен молча ронять всю сборку —
                    # печатаем понятную ошибку, чтобы её было видно в консоли
                    print(f"COMPILE ERROR in {src_file}:\n{e}")
                    errors += 1
            elif name.endswith(".pyc"):
                continue
            else:
                # прочие ресурсы (html/js/css/json и т.п.) копируем как есть
                shutil.copy2(src_file, os.path.join(dst_root, name))
                copied += 1

    if errors:
        print(f"ERROR: {errors} file(s) failed to compile")
        sys.exit(1)

    print(f"Compiled {compiled} .py -> .pyc, copied {copied} resource files")
    print(f"Protected core: {out}")

    # sanity check: server.pyc должен существовать (точка входа импортирует server)
    if not os.path.exists(os.path.join(out, "server.pyc")):
        print("ERROR: server.pyc not produced")
        sys.exit(1)


if __name__ == "__main__":
    main()