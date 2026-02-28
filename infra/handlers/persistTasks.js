module.exports.handler = async (event) => {
  console.log("PersistTasks", JSON.stringify(event));
  return event;
};
