const Alexa = require('ask-sdk');

// launch skill without an intent
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  handle(handlerInput) {
    const speechText = 'Welcome to Act Track, you can modify, look at, and add time to your activities try saying, add one minute to learning!';
    const reprompt = 'help me'
    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt(reprompt)
      .getResponse();
  },
};

const addTimeIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'addTimeIntent';
  },
  async handle(handlerInput) {
    // insert code to update dynamoDB for user here
    const activityInput = handlerInput.requestEnvelope.request.intent.slots.activity.value;
    const timeInput = handlerInput.requestEnvelope.request.intent.slots.time.value;
    const attributesManager = handlerInput.attributesManager;

    //const alexaTrakTable = new dynamoDbPersistenceAdapter({tableName : 'alexa-trak', partitionKeyName : "userId",
    //  attributesName: "activity", createTable : true});
    //let activity = alexaTrakTable.getAttributes(requestEnvelope : handlerInput.requestEnvelope)
    let attributes = await attributesManager.getPersistentAttributes() || {};
    attributes.activity = activityInput
    attributesManager.setPersistentAttributes(attributes);
    await attributesManager.savePersistentAttributes();
    const speechText = `${timeInput} has been added to ${activityInput}`;
    // probably do an if statement to check if activity exists or if time is valid
    // and return some type of speechText error that reprompts the user to fix their mistake
    // return speechText that shows intent was handled
    return handlerInput.responseBuilder
      .speak(speechText)
      .getResponse();
  },
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const speechText = 'You can say hello to me!';

    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt(speechText)
      .withSimpleCard('Hello World', speechText)
      .getResponse();
  },
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    const speechText = 'Goodbye!';

    return handlerInput.responseBuilder
      .speak(speechText)
      .withSimpleCard('Hello World', speechText)
      .getResponse();
  }
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    //any cleanup logic goes here
    return handlerInput.responseBuilder.getResponse();
  }
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`);

    return handlerInput.responseBuilder
      .speak('Sorry, I can\'t understand the command. Please say again.')
      .reprompt('Sorry, I can\'t understand the command. Please say again.')
      .getResponse();
  },
};

exports.handler = Alexa.SkillBuilders.standard()
  .addRequestHandlers(
    LaunchRequestHandler,
    addTimeIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .withTableName('alexa-trak')
  .withAutoCreateTable(true) // errorhandler does not exist
  .lambda();
