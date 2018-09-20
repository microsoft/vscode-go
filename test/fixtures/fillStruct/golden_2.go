package main

import (
	"net/http"
)

func main() {
	_ = http.Client{
		Transport:     nil,
		CheckRedirect: func(*http.Request, []*http.Request) error { panic("not implemented") },
		Jar:           nil,
		Timeout:       0,
	}
}
