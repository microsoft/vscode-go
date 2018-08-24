package main

import (
	"fmt"
)

// L
var Language = "english" // should not invoke completion since this is line comment

// G
const GreetingText = "Hello"

// S
func SayHello() {
	fmt.Println("Says hello!")
}

// HelloParams
type HelloParams struct {
	language string
}

type Vertex struct {
	X, Y float64
}

// A
func (v Vertex) Abs() float64 {
	return (v.X*v.X + v.Y*v.Y)
}
