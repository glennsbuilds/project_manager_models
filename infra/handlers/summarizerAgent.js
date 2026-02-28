module.exports.handler = async (event) => {
  console.log("SummarizerAgent", JSON.stringify(event));
  return event;
};
