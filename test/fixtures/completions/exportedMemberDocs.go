package main

import (
	"fmt"
)

//
var Language = "english"

var (
	//
	Greeting = "Hello"
	// 
	GreetingText = "Hello World!"
)

const (
	//
	HelloStatus = 0
	//
	GreetingStatus = 1
)

//
func SayHello() {
	fmt.Println("Says hello!")
}

// HelloParams
type HelloParams struct {
	language string
}

type (
	//
	Point struct{ x, y float64 }
)
