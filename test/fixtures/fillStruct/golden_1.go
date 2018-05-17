package main

import "time"

type Struct struct {
	String string
	Number int
	Float  float64
	Time   time.Time
}

func main() {
	myStruct := Struct{
		String: "",
		Number: 0,
		Float:  0.0,
		Time:   time.Time{},
	}
}
