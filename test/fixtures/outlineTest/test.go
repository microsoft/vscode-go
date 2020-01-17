package main

import (
	"fmt"
)

var _ string = "foobar"

// const constFoo = "constBar"

func print(txt string) {
	fmt.Println(txt)
}
func main() {
	print("Hello")
}

type foo struct {
	bar int
}

type circle interface {
	radius float64
}

