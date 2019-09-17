workflow "New workflow" {
  on = "push"
}

workflow "New workflow 1" {
  resolves = ["gracias"]
  on = "push"
}

action "gracias" {
  uses = "gracias"
}
