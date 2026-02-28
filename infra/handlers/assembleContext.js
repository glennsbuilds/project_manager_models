module.exports.handler = async (event) => {
  console.log("AssembleContext", JSON.stringify(event));

  // Stub implementation: assemble content into a single message
  const contentText = event.content
    .map(item => `[${item.timestamp}] ${item.author}: ${item.body}`)
    .join("\n\n");

  return {
    conversation_id: event.conversation_id,
    actor_id: event.actor_id,
    is_new: event.is_new,
    assembled_message: `Conversation context:\n\n${contentText}`,
  };
};
