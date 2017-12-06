#!/bin/bash

terminateTree() {
	for cpid in $(/usr/bin/pgrep -P $1); do
		terminateTree $cpid
		kill -9 $1 > /dev/null 2>&1
done
}

for pid in $*; do
	terminateTree $pid
done
