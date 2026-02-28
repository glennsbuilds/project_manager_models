module.exports.handler = async (event) => {
  console.log("EmitEvents", JSON.stringify(event));
  return event;
};
