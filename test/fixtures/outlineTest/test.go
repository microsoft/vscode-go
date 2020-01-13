package main

import (
	"fmt"
)

var _ string = "foobar"

// const constFoo = "constBar"

type circle struct {
	radius float64
}

func print(txt string) {
	fmt.Println(txt)
}
func main() {
	print("Hello")
}

type foo struct {
	bar int
}
