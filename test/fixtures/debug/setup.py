# This script traverses all fixtures (.go files),
# moves them into separate, individual subfolders, and will initialize
# them as go modules (go 1.11+ required)

# Caveats:
# 	- It will not work with source code files that contain local dependencies
# 	- File <-> module mapping is currently 1:1, so fixtures consisting of multiple
# 	files will be have to be handled manually

import os
import shutil
import subprocess

os.chdir(os.path.dirname(__file__))

baseModulePath = "github.com/microsoft/vscode-go/gofixtures/debug/"

for dirpath, dirnames, filenames in os.walk(os.getcwd()):
	print("Relocating test fixtures from {}".format(dirpath))
	for file in filenames:
		if file == "setup.py":
			continue
		if file == "LICENSE" or file == "LICENSE.txt":
			continue
		if not os.path.isfile(dirpath + "/" + file):
			continue

		targetName = file.replace(".go", "")
		targetDir = dirpath + "/" + targetName

		try:
			os.mkdir(targetDir)
		except OSError:
			print("Creation of the directory {} failed".format(dirpath))
		else:
			print("Successfully created the directory {}".format(dirpath))
		
		shutil.move(dirpath + "/" + file, targetDir + "/" + file)

		args = ["go", "mod", "init", baseModulePath + targetName]
		print("Running command with args '{}'".format(args))
		p = subprocess.Popen(args, cwd=targetDir)
		p.wait()
	print("Finished")
