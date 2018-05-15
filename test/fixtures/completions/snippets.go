package main

import "fmt"

type HandlerFunc func(string, string) (string, string)
type HandlerFuncWithArgNames func(w string, r string) int
type HandlerFuncNoReturnType func(string, string)

func main(){
	fmt.Println("hello")
	funcAsVariable := func (k string) {}
	funcAsVariable("hello")
}

H