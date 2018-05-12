package main

import (
	"fmt"
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
