module.exports.handler = async (event) => {
  console.log("PersistCheckpoint", JSON.stringify(event));
  return event;
};
