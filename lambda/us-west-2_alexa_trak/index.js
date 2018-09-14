const Alexa = require('ask-sdk');
var moment = require('moment');
moment().format();
// launch skill without an intent
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  async handle(handlerInput) {
    const attributesManager = handlerInput.attributesManager
    const dynamoDb = await attributesManager.getPersistentAttributes() || {};
    if (!dynamoDb.activityLog || !dynamoDb.activityList) {
      if (!dynamoDb.activityList) {
        dynamoDb.activityList = {}
      }
      if (!dynamoDb.activityLog) {
        dynamoDb.activityLog = {}
      }
      attributesManager.setPersistentAttributes(dynamoDb);
      await attributesManager.savePersistentAttributes();
    }
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
    return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      handlerInput.requestEnvelope.request.intent.name === 'addTimeIntent';
  },
  async handle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    let activityInput = request.intent.slots.activity.value;
    let timeInput = request.intent.slots.time.value;
    const attributesManager = handlerInput.attributesManager;
    let timestamp = request.timestamp;
    const dynamoDb = await attributesManager.getPersistentAttributes() || {};
    let sessionAttributes = attributesManager.getSessionAttributes() || {};
    let activityList = dynamoDb.activityList
    let speechText = ""
    if (!activityInput) {
      return handlerInput.responseBuilder
        .addDelegateDirective()
        .getResponse();
    } else if (!activityList[activityInput]) {
      if (!timeInput) {
        speechText = `You said you wanted to add time to ${activityInput}, right?`
        timeInput = 'time'
      } else {
        speechText = `You said you wanted to add ${moment.duration(timeInput).humanize()} to ${activityInput}, right?`
      }
      if (request.intent.slots.activity.confirmationStatus === "CONFIRMED") {
        speechText = `I don't know this activity, would you like me to remember ${activityInput}?`
        attributesManager.setSessionAttributes({
          createActivity : 'CONFIRMED',
          "timeInput" : timeInput, "activityInput" : activityInput
        })
        return handlerInput.responseBuilder
          .speak(speechText)
          .withShouldEndSession(false)
          .getResponse();
      }
      return handlerInput.responseBuilder
        .speak(speechText)
        .addConfirmSlotDirective("activity")
        .getResponse();
    } else if (!timeInput) {
      return handlerInput.responseBuilder
        .addDelegateDirective()
        .getResponse();
    } else {
      timeInput = moment.duration(timeInput)
      let actLogKey = activityInput + "/" + timestamp
      let activityLog = dynamoDb.activityLog
      dynamoDb.activityLog = Object.assign(
        activityLog, {[actLogKey] : timeInput.asMinutes()}
      )
      attributesManager.setPersistentAttributes(dynamoDb);
      await attributesManager.savePersistentAttributes();
      speechText = `${timeInput.humanize()} has been added to ${activityInput}`;
      return handlerInput.responseBuilder
        .speak(speechText)
        .getResponse();
    }
  },
};

const createActivityIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
      (request.intent.name === 'AMAZON.YesIntent' ||
       request.intent.name === 'createActivityIntent')
  },
  async handle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    const responseBuilder = handlerInput.responseBuilder;
    const attributesManager = handlerInput.attributesManager;
    const dynamoDb = await attributesManager.getPersistentAttributes() || {};
    const sessionAttributes = attributesManager.getSessionAttributes() || {};
    const timestamp = request.timestamp;
    let speechText = ""
    // addTimeIntent to createActivityIntent
    if (request.intent.name === 'AMAZON.YesIntent' && sessionAttributes.createActivity === 'CONFIRMED') {
      let timeInput = sessionAttributes.timeInput
      let activityInput = sessionAttributes.activityInput
      speechText = `Alright, You can start tracking your hours for ${activityInput} now.`
      let activityList = dynamoDb.activityList
      dynamoDb.activityList = Object.assign(
        activityList, {[activityInput] : timestamp}
      )
      if (timeInput !== 'time') {
        timeInput = momemt.duration(timeInput)
        speechText = `I can remember ${activityInput} now and I went ahead and added ${timeInput.humanize()} to it.`
        let actLogKey = activityInput + "/" + timestamp
        let activityLog = dynamoDb.activityLog
        dynamoDb.activityLog = Object.assign(
          activityLog, {[actLogKey] : timeInput.asMinutes()}
        )
      }
      attributesManager.setPersistentAttributes(dynamoDb);
      await attributesManager.savePersistentAttributes();
      return responseBuilder
        .speak(speechText)
        .getResponse();
    }
    const activityInput = request.intent.slots.activity.value
    if (dynamoDb.activityList && request.intent.name === 'createActivityIntent') {
      speechText = `${activityInput} already exists.`
      return responseBuilder
      .speak(speechText)
      .getResponse();
    } else {
      speechText = `Alright, You can start tracking your hours for ${activityInput} now.`
      return responseBuilder
        .speak(speechText)
        .getResponse();
    }
  },
};

const retrieveActivityIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest'
      && request.intent.name === 'retrieveActivityIntent'
  },
  async handle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    const responseBuilder = handlerInput.responseBuilder;
    const attributesManager = handlerInput.attributesManager;
    const dynamoDb = await attributesManager.getPersistentAttributes() || {};
    const timestamp = request.timestamp;
    const activityList = dynamoDb.activityList
    const activityLog = dynamoDb.activityLog
    let activitySum = {}
    for (var key in activityList) {
      if(activityList.hasOwnProperty(key)) {
        activitySum[key] = 0;
      }
    }
    if (!request.intent.slots.date.value && !request.intent.slots.activity.value) {
      let today = moment(timestamp).format("YYYY-MM-DD");
      for (var key in activityLog) {
        if(activityLog.hasOwnProperty(key) && key.toString().includes(today)) {
          let parsedActivity = key.substring(0, key.indexOf('/'))
          activitySum[parsedActivity] = activitySum[parsedActivity] + activityLog[key]
        }
      }
    }
    // if statements for specific activities and timeframes
    // also if statements for when there is not enough data in given timeframe (week, month, year), activity does not exist
    // ^possibly just give data up to a certain point (basically how far the timeframe can cover, if there is not enough data) <--- DO THIS INSTEAD
    // then start adding more utterances, figure out how to invoke intents without invocationName
    // 
    return responseBuilder
      .speak(speechText)
      .getResponse();
  },
}

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

function delegateSlotCollection() {
  let updatedIntent = this.event.request.intent;

  // We only need to restore state if we aren't COMPLETED.
  if (this.event.request.dialogState !== "COMPLETED") {
      if (this.attributes['temp_' + this.event.request.intent.name]) {
          let tempSlots = this.attributes['temp_' + this.event.request.intent.name].slots;

          Object.keys(tempSlots).forEach(currentSlot => {
              if (tempSlots[currentSlot].value) {
                  this.event.request.intent.slots[currentSlot] = tempSlots[currentSlot]
              }
          }, this);
      } else {
          this.attributes['temp_' + this.event.request.intent.name] = this.event.request.intent;
      }
  } else {
      delete this.attributes['temp_' + this.event.request.intent.name];
  }

  if (this.event.request.dialogState === "STARTED") {

      // optionally pre-fill slots: update the intent object with slot values
      // for which you have defaults, then return Dialog.Delegate with this
      // updated intent in the updatedIntent property

      disambiguateSlot.call(this);
      console.log("disambiguated: " + JSON.stringify(this.event));
      this.emit(":delegate", updatedIntent);

  } else if (this.event.request.dialogState !== "COMPLETED") {
      console.log("in not completed");
      //console.log(JSON.stringify(this.event));

      disambiguateSlot.call(this);
      this.emit(":delegate", updatedIntent);
  } else {

      console.log("in completed");

      // Dialog is now complete and all required slots should be filled,
      // so call your normal intent handler.
      return this.event.request.intent.slots;
  }
  return null;
}

function objToString (obj) {
    var str = '';
    for (var p in obj) {
        if (obj.hasOwnProperty(p)) {
            str += p + '::' + obj[p] + '\n';
        }
    }
    return str;
}

exports.handler = Alexa.SkillBuilders.standard()
  .addRequestHandlers(
    LaunchRequestHandler,
    addTimeIntentHandler,
    createActivityIntentHandler,
    retrieveActivityIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .withTableName('alexa-trak')
  .withAutoCreateTable(true)
  .lambda();
