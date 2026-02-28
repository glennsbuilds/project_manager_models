module.exports.handler = async (event) => {
  console.log("PersistMessage", JSON.stringify(event));
  return event;
};
