package main

import "fmt"

func main() {
	fmt.Print()
	funcAsVariable := func(k int) {}
	hello(funcAs)
	bye(funcAs, 1)
}

type convert func(int) string

func hello(s convert) {
	return s(1)
}

func bye(s convert, i int) {
	return s(i)
}
