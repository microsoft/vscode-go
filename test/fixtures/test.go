package main

import (
	"fmt"
)

func print(txt string) {
	fmt.Println(txt)
}
func main() {
	print("Hello")
}

// Hello print txt
func Hello(txt string) {
	fmt.Println(txt)
}

// Cat an struct of cat
type Cat struct {
	Name string
}