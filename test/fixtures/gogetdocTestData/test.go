package abc

import (
	"fmt"
	"math"
	"net"
)

// ABC is a struct, you coudnt use Goto Definition or Hover info on this before
// Now you can due to gogetdoc
type ABC struct {
	a int
	b int
	c int
}

// This is an unexported function so couldnt get this comment on hover :(
// Not anymore!! gogetdoc to the rescue
func print(txt string) {
	fmt.Println(txt)
}

func main() {
	print("Hello")
}

// Hello is a method on the struct ABC. Will signature help understand this correctly
func (abcd *ABC) Hello(s string, exclaim bool) string {
	net.CIDRMask(10, 20)
	if exclaim {
		s = s + "!"
	}
	if abcd.a+abcd.b+abcd.c > 3 {
		return "Hello " + s
	}
	return "GoodBye " + s
}

// Greetings is an exported function. So all is good.
func Greetings() string {
	xyz := ABC{1, 2, int(math.Abs(-1))}
	return xyz.Hello("World", false)
}
