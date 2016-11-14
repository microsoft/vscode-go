package abc

const ABC = 123

func unExported() int {
	return 1
}

func Exported() string {
	return "Hello,world"
}
