package main

import (
	"net/http"
)

func main() {
	_ = http.Client{
		Transport:     nil,
		CheckRedirect: nil,
		Jar:           nil,
		Timeout:       0,
	}
}
