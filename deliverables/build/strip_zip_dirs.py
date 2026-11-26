import sys, zipfile, shutil
p = sys.argv[1]; tmp = p + ".tmp"
with zipfile.ZipFile(p) as zi, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zo:
    for it in zi.infolist():
        if not it.filename.endswith("/"): zo.writestr(it, zi.read(it.filename))
shutil.move(tmp, p); print("stripped", p)
