package file1

import (
	"fmt"
	"math"
)

function main(){
	hello:= sayHello("my friend");


	bye:= sayBye("my friend");
	randomNumber:= math.Abs(-1);




	fmt.Println(hello);
}

//Line 1 comments for sayHello
//Line 2 comments for sayHello
//Line 3 comments for sayHello
function sayHello(string name) string {
	return "Hello " + name;
}

//Line 1 comments for sayBye
//Line 2 comments for sayBye
//Line 3 comments for sayBye
function sayBye(string name) string {
	return "Bye " + name;
}