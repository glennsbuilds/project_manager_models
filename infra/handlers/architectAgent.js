module.exports.handler = async (event) => {
  console.log("ArchitectAgent", JSON.stringify(event));
  return event;
};
