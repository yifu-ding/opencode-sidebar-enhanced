export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type Todo = { readonly content: string; readonly status: TodoStatus };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Same source as the native Todo panel: latest completed todowrite before revert. */
export function sessionTodos(messages: readonly unknown[], revertID?: string): readonly Todo[] {
  const boundary = revertID ? messages.findIndex((value) => record(value)?.id === revertID) : -1;
  const end = boundary < 0 ? messages.length : boundary;
  for (let index = end - 1; index >= 0; index--) {
    const message = record(messages[index]);
    if (message?.type !== "assistant" || !Array.isArray(message.content)) continue;
    for (let part = message.content.length - 1; part >= 0; part--) {
      const tool = record(message.content[part]);
      const state = record(tool?.state);
      if (tool?.type !== "tool" || tool.name !== "todowrite" || state?.status !== "completed") continue;
      const todos = record(state.input)?.todos;
      if (!Array.isArray(todos)) return [];
      return todos.flatMap((value): Todo[] => {
        const todo = record(value);
        if (!todo || typeof todo.content !== "string" || !todo.content) return [];
        const status = todo.status;
        return [{ content: todo.content, status: status === "in_progress" || status === "completed" || status === "cancelled" ? status : "pending" }];
      });
    }
  }
  return [];
}
