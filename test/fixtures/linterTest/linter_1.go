package linterTest

import "fmt"

func ExportedFunc() {
	a := 10
	func() {
		a := 20
	}()

	fmt.Println("OUTER A: ", a)
}
