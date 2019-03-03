package main

import (
	"fmt"
	"os"
	"testing"
)

func hello() {
	fmt.Println("Hello")
}

// TestMe
func TestMe(t *testing.T) {
	if os.Getenv("dummyEnvVar") != "dummyEnvValue" {
		t.Errorf("Oops! Value for the variable is %q", os.Getenv("dummyEnvVar"))
	}
}
