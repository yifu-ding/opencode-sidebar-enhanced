import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionTodos } from "./todos.ts";

const message = (id: string, todos: unknown, status = "completed") => ({
  id, type: "assistant", content: [{ type: "tool", name: "todowrite", state: { status, input: { todos } } }],
});
test("Todo reads the latest completed write and respects reverts", () => {
  const first = [{ content: "First", status: "pending" }];
  const second = [{ content: "Second", status: "in_progress" }];
  const messages = [message("a", first), message("b", second), message("c", [], "running")];
  assert.deepEqual(sessionTodos(messages), second);
  assert.deepEqual(sessionTodos(messages, "b"), first);
  assert.deepEqual(sessionTodos(messages, "a"), []);
  assert.deepEqual(sessionTodos(messages, "missing"), second);
});
test("Todo normalizes malformed rows and permits clearing the list", () => {
  assert.deepEqual(sessionTodos([message("a", [null, {}, { content: "" }, { content: "Task", status: "unknown" }])]), [{ content: "Task", status: "pending" }]);
  assert.deepEqual(sessionTodos([message("a", [{ content: "Old" }]), message("b", [])]), []);
  assert.deepEqual(sessionTodos([null, {}]), []);
});
