package testargstest

import (
	"flag"
	"fmt"
	"os"
	"testing"
)

func TestMain(m *testing.M) {

	// test that we can pass test-specific arguments with '-args'

	fmt.Fprintf(os.Stderr, "args: %#v", os.Args)

	foo := flag.String("foo", "", "test foo arg")
	flag.Parse()

	if *foo != "testval" {
		os.Exit(1)
	}

	os.Exit(0)
}
