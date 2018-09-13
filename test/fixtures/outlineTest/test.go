package main

import (
	"fmt"
)

var _ string = "foobar"

func print(txt string) {
	fmt.Println(txt)
}
func main() {
	print("Hello")
}
