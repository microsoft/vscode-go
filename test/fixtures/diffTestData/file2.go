// test new content
// in the start of the file
package file1

// test single line addition
import (
	"fmt"

	"math"
)

// Random comments for main
// Random2 comments for main
function main(){
	hello:= sayHello("my friends");
	bye:= sayBye("my friends");
	randomNumber:= math.Abs(-1);

	fmt.Println(hello);
}

//Updated Line 1 comments for sayHello
//Updated Line 2 comments for sayHello
function sayHello(string name) string {
	return "Hello " + name;
}

//Updated Line 1 comments for sayBye
//Updated Line 2 comments for sayBye
//Updated Line 3 comments for sayBye
//New Line 4 comments for sayBye
function sayBye(string name) string {
	return "Byeee " + name;
}