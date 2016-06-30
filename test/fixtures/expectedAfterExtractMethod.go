package main

import (
	"fmt"
)

func print(txt string) {
	fmt.Println(txt)
}
func main() {
	print("Hello")

	a := 1
	b := 2
	add(a, b)
}
func add(a int, b int) {
	c := a + b
	fmt.Println(c)
}
