const Alexa = require('ask-sdk');
var moment = require('moment-timezone');
const https = require('https');
const rp = require('request-promise');
// launch skill without an intent
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  async handle(handlerInput) {
    const attributesManager = handlerInput.attributesManager
    const requestEnvelope = handlerInput.requestEnvelope
    const dynamoDb = await attributesManager.getPersistentAttributes() || {};
    let serverTimestamp = requestEnvelope.request.timestamp;
    let speechText = 'Welcome to SaveTime, you can modify, look at, and add time to your activities. For a list of commands just say, help!';
    let cardText = speechText
    if (!dynamoDb.activityList) {
      dynamoDb.activityList = {
        relaxing : serverTimestamp,
        exercise : serverTimestamp,
        work : serverTimestamp,
        eating : serverTimestamp,
        transport : serverTimestamp,
        learning : serverTimestamp,
        sleep : serverTimestamp,
        entertainment : serverTimestamp
      }
    }
    if (!dynamoDb.activityLog) {
      dynamoDb.activityLog = {}
    }
    if (!dynamoDb.personal) {
      dynamoDb.personal = {"timezone" : ""}
    }
    let timezoneObj = dynamoDb.personal.timezone
    if (!timezoneObj || Object.keys(timezoneObj).length === 0 && timezoneObj.constructor === Object) {
      const {apiAccessToken} = requestEnvelope.context.System
      const { deviceId } = requestEnvelope.context.System.device
      var options = {
        uri : 'https://api.amazonalexa.com/v2/devices/' + deviceId + '/settings/System.timeZone',
        headers : {
          'Authorization' : "Bearer " + apiAccessToken
        },
        json: true
      };
      let timezone = ""
      await rp(options)
      .then(function (responseFrom) {
        timezone = responseFrom
      })
      .catch(function (err) {
        console.log(err)
      })
      if (!timezone) {
        speechText += '\n it looks like you have not set a preferred timezone for this device. \
                       Please set one before logging your activities with Time Save. \
                       Otherwise, I won\'t be able to accurately track your time'
        cardText = 'Please set your preferred timezone in your device settings. These settings are located on the Alexa App.'
      } else {
        // possibly add way to confirm if timezone is correct later
        dynamoDb.personal = {"timezone" : timezone}
      }
    }
    attributesManager.setPersistentAttributes(dynamoDb);
    await attributesManager.savePersistentAttributes();
    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt('Try saying, what did I do today')
      .getResponse();
  },
};

const addTimeIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
      (handlerInput.requestEnvelope.request.intent.name === 'addTimeIntent' /*||
       handlerInput.requestEnvelope.request.intent.name === 'AMAZON.NoIntent'*/);
  },
  async handle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    let activityInput = request.intent.slots.activity.value;
    let timeInput = request.intent.slots.time.value;
    const attributesManager = handlerInput.attributesManager;
    const dynamoDb = await attributesManager.getPersistentAttributes() || {};
    let sessionAttributes = attributesManager.getSessionAttributes() || {};
    const serverTimestamp = request.timestamp;
    const timezone = dynamoDb.personal.timezone
    let timestamp = moment.tz(serverTimestamp , timezone).format("YYYY-MM-DDTHH:mm:ssZ")
    let activityList = dynamoDb.activityList
    let speechText = ""
    let synonym = ""
    if (!activityInput || activityInput === 'activity') {
      speechText = "what activity would you like to log?"
      return handlerInput.responseBuilder
        .speak(speechText)
        .addElicitSlotDirective('activity')
        .getResponse();
    }
    if (activityInput) {
      synonym = findSynonym(handlerInput)
      console.log(synonym)
    }
    if (!activityList[activityInput] && !activityList[synonym]) {
      console.log(activityInput)
      if (!timeInput) {
        speechText = `You said you wanted to add time to ${activityInput}, right?`
        timeInput = 'time'
      } else {
        speechText = `You said you wanted to add ${moment.duration(timeInput).humanize()} to ${activityInput}, right?`
      }
      // URGENT: MOVE TO createActivityIntent
      if (request.intent.slots.activity.confirmationStatus === "CONFIRMED") {
        speechText = `I don't know this activity, would you like me to remember ${activityInput}?`
        attributesManager.setSessionAttributes({
          createConfirm : "PENDING", "timestamp" : timestamp.toString(),
          "timeInput" : timeInput, "activityInput" : activityInput, intentName : "request.intent.name",
          synonym : findSynonym(handlerInput)
        })
        return handlerInput.responseBuilder
          .speak(speechText)
          .reprompt(speechText)
          .getResponse();
      } else if (request.intent.slots.activity.confirmationStatus === "DENIED") {
        speechText = `Okay, what activity would you like to add time to?`
        return handlerInput.responseBuilder
          .speak(speechText)
          .addElicitSlotDirective('activity')
          .getResponse()
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
      synonym = (findSynonym(handlerInput) ? findSynonym(handlerInput) : activityInput)
      let actLogKey = synonym + "/" + timestamp
      let activityLog = dynamoDb.activityLog
      dynamoDb.activityLog = Object.assign(
        activityLog, {[actLogKey] : timeInput.asMinutes()}
      )
      attributesManager.setPersistentAttributes(dynamoDb);
      await attributesManager.savePersistentAttributes();
      speechText = `${timeInput.humanize()} has been added to ${activityInput}`;
      return handlerInput.responseBuilder
        .speak(speechText)
        .withSimpleCard('SaveTime', speechText)
        .getResponse();
    }
  },
};

// create a handler for No intents
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
    const requestAttributes = attributesManager.getRequestAttributes() || {};
    const serverTimestamp = request.timestamp;
    const timezone = dynamoDb.personal.timezone
    let timestamp = moment.tz(serverTimestamp , timezone).format("YYYY-MM-DDTHH:mm:ssZ")
    let speechText = ""
    let activityList = dynamoDb.activityList
    let cardText = ""
    // addTimeIntent to createActivityIntent
    if (request.intent.name === 'createActivityIntent') {
      let activityInput = request.intent.slots.activity.value
      if (!activityInput) {
        speechText = 'What activity would you like me to remember?'
        return responseBuilder
          .speak(speechText)
          .addElicitSlotDirective('activity')
          .withSimpleCard('SaveTime', 'Give me an activity to track. To quit, try "Alexa, exit"')
          .getResponse();
      }
      if (activityList[activityInput] && request.intent.name === 'createActivityIntent') {
        speechText = `I already know ${activityInput}.`
      } else {
        const activityResolution = request.intent.slots.activity.resolutions
        let actualAct = (findSynonym(handlerInput) ? findSynonym(handlerInput) : activityInput)
        speechText = `Alright, You can start tracking your hours for ${activityInput} now.`
        dynamoDb.activityList = updateObjHelper(activityList, actualAct, timestamp) //old obj, key, value
      }
      attributesManager.setPersistentAttributes(dynamoDb);
      await attributesManager.savePersistentAttributes();
      return responseBuilder
        .speak(speechText)
        .withSimpleCard('SaveTime', `${activityInput} has been added to the log.`)
        .getResponse();
    } else if (requestAttributes.createConfirm === 'CONFIRMED') {
      if (requestAttributes.activityInput) {
        let timeInput = requestAttributes.timeInput
        let activityInput = requestAttributes.activityInput
        let synonym = requestAttributes.synonym
        speechText = `Alright, You can start tracking your hours for ${activityInput} now.`
        dynamoDb.activityList = updateObjHelper(activityList, (synonym ? synonym : activityInput), timestamp)
        if (timeInput && timeInput !== 'time') {
          timeInput = moment.duration(timeInput)
          speechText = `I can remember ${activityInput} now and I went ahead and added ${timeInput.humanize()} to it.`
          let actLogKey = (synonym ? synonym : activityInput) + "/" + timestamp
          let activityLog = dynamoDb.activityLog
          dynamoDb.activityLog = updateObjHelper(activityLog, actLogKey, timeInput.asMinutes())
          cardText = `${activityInput} has been added to the log with ${timeInput.humanize()}`
        }
        attributesManager.setPersistentAttributes(dynamoDb);
        await attributesManager.savePersistentAttributes();
        return responseBuilder
          .speak(speechText)
          .withSimpleCard('SaveTime', cardText)
          .getResponse();
      } /*else {//(!requestAttributes.activityInput) { // no activity name
        speechText = "Okay, what is the name of the activity you would like me to start tracking?"
        attributesManager.setSessionAttributes(
          updateObjHelper(Object.assign(sessionAttributes, requestAttributes), "getActivityName", 'CONFIRMED')
        )
        return responseBuilder
          .speak(speechText)
          .reprompt(speechText)
          .getResponse()
      }*/
    }
    return responseBuilder
      .speak('Hmm, I\'m not sure.')
      .withSimpleCard('SaveTime', "Try saying, create new activity")
      .getResponse();
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
    const serverTimestamp = request.timestamp;
    const timezone = dynamoDb.personal.timezone;
    const timestampMomentObj = moment.tz(serverTimestamp , timezone).format("YYYY-MM-DD")
    const activityList = dynamoDb.activityList
    const activityLog = dynamoDb.activityLog
    //should already be in ISO-8601 YYYY-{MM}-{DD} or undefined
    let dateInput = request.intent.slots.date.value
    let speechText = ''
    let activityInput = request.intent.slots.activity.value
    let actualAct = activityInput
    let activitySum = {}
    let dateTrack = ""
    let dateString = 'today'
    if (activityInput && findSynonym(handlerInput)) {
        actualAct = findSynonym(handlerInput)
      }
    if (activityInput && !activityList[actualAct]) {
      speechText = `Sorry, I don't have ${activityInput} remembered. \
      Would you like me to keep track of ${activityInput} from now on?`
      attributesManager.setSessionAttributes({
        createConfirm : "PENDING", "timestamp" : timestampMomentObj.toString(),
        "activityInput" : activityInput, intentName : request.intent.name,
        synonym : actualAct
      })
      return handlerInput.responseBuilder
        .speak(speechText)
        .reprompt(speechText)
        .getResponse();
    }
    if (!dateInput || dateInput === timestampMomentObj.toString()) {
      dateTrack = timestampMomentObj;
    } else if (moment.tz(serverTimestamp , timezone).utc().isBefore(dateInput)) {
      dateTrack = timestampMomentObj;
      speechText = "I'm sorry, you asked for your activities in the future. \
      Since I don't know the future I will just give you your activities for today."
    } else {
      dateTrack = dateInput
      dateString = dateInput
    }
    if (!activityInput) {
      for (var key in activityList) {
        if(activityList.hasOwnProperty(key)) {
          activitySum[key] = 0;
        }
      }
      for (var key in activityLog) {
        if(activityLog.hasOwnProperty(key) && key.toString().includes(dateTrack)) {
          let parsedActivity = key.substring(0, key.indexOf('/'))
          activitySum[parsedActivity] = activitySum[parsedActivity] + activityLog[key]
        }
      }
      speechText += `Here is a log of your activities for ${dateString}.\n`
      for (var key in activitySum) {
        activitySum = calculateAndConvertTime(activitySum, key)
        speechText += `You spent ${activitySum[key]}${includeDoing(key)}${key}.\n`
      }
    } else {
      activityInput = actualAct
      activitySum = {[activityInput] : 0}
      for (var key in activityLog) {
        if(activityLog.hasOwnProperty(key) && key.toString().includes(dateTrack) && key.includes(activityInput)) {
          activitySum[activityInput] = activitySum[activityInput] + activityLog[key]
        }
      }
      activitySum = calculateAndConvertTime(activitySum, activityInput)
      if (dateString === 'today') {
        speechText += `You spent ${activitySum[activityInput]}${includeDoing(activityInput)}${activityInput} today.`
      } else {
        speechText += `You spent ${activitySum[activityInput]}${includeDoing(activityInput)}${activityInput} on ${dateString}.`
      }
    }
    /* else {
      for (var key in activityList) {
        if(activityList.hasOwnProperty(key) && key in activityInput) {
          activitySum[key] = 0;
        }
      }
    }*/

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

const listActivitiesIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest'
      && request.intent.name === 'listActivitiesIntent'
  },
  async handle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    const responseBuilder = handlerInput.responseBuilder;
    const attributesManager = handlerInput.attributesManager;
    const dynamoDb = await attributesManager.getPersistentAttributes() || {};
    const sessionAttributes = attributesManager.getSessionAttributes() || {};
    const requestAttributes = attributesManager.getRequestAttributes() || {};
    let activityList = dynamoDb.activityList
    let speechText = ''
    if (Object.keys(activityList).length === 0 && activityList.constructor === Object) {
      speechText = 'You currently have no activities that I can track. \
                    If you would like me to start logging an activity, just say, \
                    Alexa, ask Time Save to remember an activity for me.'
      return responseBuilder
        .speak(speechText)
        .withSimpleCard('SaveTime', 'You have no activities to log.')
        .getResponse()
    } else {
      speechText = 'Here is a list of activities I\'m tracking for you.\n'
      let cardText = 'Activities:\n   '
      let keys = Object.keys(dynamoDb.activityList)
      for (let i = 0; i < keys.length - 1; i++) {
        speechText += `${keys[i]}, `
        cardText += `${keys[i]}, `
      }
      if (keys.length > 1) {
        speechText += `and ${keys[keys.length - 1]}.`
      } else {
        speechText += `${keys[0]}.`
      }
      return responseBuilder
        .speak(speechText)
        .withSimpleCard('SaveTime', cardText)
        .getResponse();
    }

  },
}
const HelpIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const speechText = 'Feel free to give me a command any time. Grab my attention by saying, Alexa. \
                        If you want a full explanation, check the Alexa app! \
                        If you want to see what kind of activities I can track just say, list my activities! \
                        To add time to an activity, say, add time to an activity. \
                        Creating a new activity is as simple as saying, create activity. \
                        If you want me to read back your time spent doing an activity today, for example learning, say, \
                        How long have I been learning. \
                        If you want to see what else I can do, check your Alexa app for a full explanation!';

    let explanation = ['To get your log for an activity for a certain time for example Learning say,\n   "Alexa, ask SaveTime to tell me how long I\'ve done Learning yesterday"\n',
                         'To get your entire time log for a certain time say,\n   "Alexa, ask SaveTime to give me my activity log for last month"\n',
                         'To log time to an activity (in this case Learning) say,\n   "Alexa, ask SaveTime to add time to Learning"',
                         'To list all activities Alexa is currently logging for you say,\n   "Alexa, ask SaveTime to list my activities".\n',
                         'You can create a new activity by saying,\n   "Alexa, ask SaveTime to create a new activity"\n',
                         'Asking for your log without specifying an activity and time will prompt Alexa to read back your SaveTime log for today\n']
    explanation = explanation.join('')
    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt("Try giving me a command!")
      .withSimpleCard('SaveTime', explanation)
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

const FallbackIntentHandler = {
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request
    return request.type === 'IntentRequest' &&
    request.intent.name === 'AMAZON.FallbackIntent'
  },
  handle(handlerInput) {
    let speechText = "I'm sorry, I don't understand. If you want me to log your time try saying, add time to an activity."
    return handlerInput.responseBuilder
      .speak(speechText)
      .reprompt(speechText)
      .getResponse();
  },
}

function findSynonym(handlerInput) {
  const activityResolution = handlerInput.requestEnvelope.request.intent.slots.activity.resolutions

  if (handlerInput.requestEnvelope.request.intent.slots.activity &&
      activityResolution && activityResolution.resolutionsPerAuthority[0].status.code === "ER_SUCCESS_MATCH") {
    return activityResolution.resolutionsPerAuthority[0].values[0].value.name
  }
  return ""
}

function includeDoing(word) {
  return (word.includes('ing') ? " " : " doing ")
}

function calculateAndConvertTime(activitySum, key) {
  if (activitySum[key] > 0) {
    var hours = Math.floor(activitySum[key] / 60)
    var min = activitySum[key] % 60
    var humanDuration = (min == 1 ? "one minute" : min + " minutes")
    if (hours != 0) {
      humanDuration = (hours == 1 ? "one hour" : hours + " hours") + (min == 0 ? "" : " and " + humanDuration)
    }
    activitySum[key] = humanDuration
  } else {
    activitySum[key] = "zero minutes"
  }
  return activitySum
}

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

function updateObjHelper(oldObj, key, value) {
  return Object.assign(oldObj, {[key] : value})
}
// not finished
// erases sessionAttributes to avoid unexpected interactions
const eraseSessionAttributesInterceptor = {
  process(handlerInput) {
    const intent = handlerInput.requestEnvelope.request.intent;
    const attributesManager = handlerInput.attributesManager;
    let sessionAttributes = attributesManager.getSessionAttributes() || {};
    if (intent) {
      let intentNames = ["addTimeIntent", "retrieveActivityIntent", "listActivitiesIntent", "deleteActivityIntent"]
      for (let i = 0; i < intentNames.length ; i++) {
        if (intentNames[i] === intent.name) {
          attributesManager.setSessionAttributes({})
          break;
        }
      }
    }
  }
}

const adaptiveCreateActRequestInterceptor = {
  process(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    const attributesManager = handlerInput.attributesManager;
    let sessionAttributes = attributesManager.getSessionAttributes() || {};
    let requestAttributes = {};
    /*if (request.intent && request.intent.name === 'createActivityIntent' && sessionAttributes.getActivityName === 'CONFIRMED') {
      delete sessionAttributes.getActivityName
      requestAttributes = Object.assign(
        requestAttributes, sessionAttributes
      )
      requestAttributes.activityInput = request.intent.slots.activity.value
      requestAttributes.synonym = findSynonym(handlerInput)
    }*/
    if (sessionAttributes.createConfirm === "PENDING") {
      if(request.intent.name === "AMAZON.YesIntent") {
        requestAttributes = Object.assign(
          requestAttributes, sessionAttributes
        )
        requestAttributes.createConfirm = 'CONFIRMED'
      } else if (request.intent.name === "AMAZON.NoIntent") {
        requestAttributes.createConfirm = 'DENIED'
        return handlerInput.responseBuilder.getResponse();
      }
    }
    sessionAttributes = ['synonym', 'createConfirm', 'timestamp', 'timeInput', 'activityInput', 'intentName'].forEach(e => delete sessionAttributes[e]);
    attributesManager.setSessionAttributes(sessionAttributes)
    attributesManager.setRequestAttributes(requestAttributes)
  }
}

exports.handler = Alexa.SkillBuilders.standard()
  .addRequestHandlers(
    LaunchRequestHandler,
    addTimeIntentHandler,
    createActivityIntentHandler,
    retrieveActivityIntentHandler,
    listActivitiesIntentHandler,
    HelpIntentHandler,
    FallbackIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler
  )
  .addRequestInterceptors(
    adaptiveCreateActRequestInterceptor,
    eraseSessionAttributesInterceptor
  )
  .addErrorHandlers(ErrorHandler)
  .withTableName('alexa-trak')
  .withAutoCreateTable(true)
  .lambda();
