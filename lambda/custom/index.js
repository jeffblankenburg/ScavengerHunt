//TODO: Sell hints to puzzles for $1.99?
//TODO: Track a user's progress.  Which puzzle are they currently playing?
//TODO: Do we allow users to play games from previous weeks?  (Maybe this is a "premium" feature, that also includes one hint a week?)
//TODO: What does the first time user experience look like?  We probably need to explain what is happening, and what they should do.
//TODO: Allow users to change their phone number, like "change my phone number."
//TODO: Give the user the option to send another pin if they don't have it.
//TODO: Give the user a way to unsubscribe and turn their phone number off.
//TODO: How does a user get a text message clue sent "again?"  What if they accidentally delete it?
//TODO: What happens if someone is playing a game while the date for the game flips?

const Alexa = require('ask-sdk-core');
const AWS = require("aws-sdk");
const https = require("https");
const Airtable = require("airtable");
const PERMISSIONS = ['alexa::profile:name:read', 'alexa::profile:email:read', 'alexa::profile:mobile_number:read'];

const introSound = "<audio src='soundbank://soundlibrary/computers/beeps_tones/beeps_tones_13'/>";

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        console.log("<=== LAUNCHREQUEST HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "LaunchRequest";
        const locale = handlerInput.requestEnvelope.request.locale;
        var speakOutput = "";
        var actionQuery = "";
        
        console.log("SESSION ATTRIBUTES = " + JSON.stringify(sessionAttributes));
        if (sessionAttributes.user.MobileNumber === undefined) {
            return PhoneNumberIntentHandler.handle(handlerInput);
        }
        else if (sessionAttributes.user.MobileNumber != undefined && sessionAttributes.user.IsValidated === undefined) {
            return PhoneNumberIntentHandler.handle(handlerInput);
        }
        else if (sessionAttributes.user.MobileNumber != undefined && sessionAttributes.user.IsValidated === true) {
            return giveNextPuzzle(handlerInput);
        }
        else {
            speakOutput = await getRandomSpeech("Welcome", locale);
            actionQuery = await getRandomSpeech("ActionQuery", locale);
        }

        speakOutput = introSound + speakOutput + " " + actionQuery;
        
        return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(actionQuery)
        .getResponse();
        
    }
};

const PhoneNumberIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'PhoneNumberIntent';
    },
    async handle(handlerInput) {
        console.log("<=== PHONENUMBERINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const locale = handlerInput.requestEnvelope.request.locale;
        var phoneNumber = getSpokenWords(handlerInput, "phoneNumber");
        var speakOutput = "";
        if (sessionAttributes.previousAction === "LaunchRequest") {
            var welcome = await getRandomSpeech("Welcome", locale);
            speakOutput = introSound + welcome + " ";
        }
        var actionQuery = "";
        sessionAttributes.previousAction = "PhoneNumberIntent";
        phoneNumber = fixPhoneNumber(phoneNumber, locale);
        if (phoneNumber != undefined) {
            var pin = getRandom(1000, 9999);
            await sendTextMessage(phoneNumber, "Your validation PIN is " + pin + ". If the skill has closed, you can say \"Alexa, tell Scavenger Hunt my pin is " + pin + "\".");
            await updateUserRecord(handlerInput, phoneNumber, pin, false);
            speakOutput += "I just sent a message with a four digit PIN to validate your mobile phone number. ";
            actionQuery = "What is that PIN?";
            sessionAttributes.expectedAction = "PinValidationIntent";
        }
        else {
            speakOutput += await getRandomSpeech("AskForPhoneNumber", locale);
            actionQuery = "What is your full mobile phone number?";
            sessionAttributes.expectedAction = "PhoneNumberIntent";
        }
        return handlerInput.responseBuilder
            .speak(speakOutput + actionQuery)
            .reprompt(actionQuery)
            .getResponse();
    }
};

const PinValidationIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'PinValidationIntent';
    },
    async handle(handlerInput) {
        console.log("<=== PINVALIDATIONINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "PinValidationIntent";
        const locale = handlerInput.requestEnvelope.request.locale;
        var pin = getSpokenWords(handlerInput, "pin");

        if (sessionAttributes.user.ValidationPin.toString() != pin.toString()) {
            console.log("PIN DIDN'T MATCH.");
            await updateUserRecord(handlerInput);
            sessionAttributes.previousAction = "PhoneNumberIntent";
            return LaunchRequestHandler.handle(handlerInput);
        }
        else {
            await updateUserRecord(handlerInput, sessionAttributes.user.MobileNumber, sessionAttributes.user.ValidationPin, true);
            sessionAttributes.previousAction = "PinValidationIntent";
            return giveNextPuzzle(handlerInput);
        }
    }
};

async function giveNextPuzzle(handlerInput) {
    console.log("<=== GIVENEXTPUZZLE FUNCTION ===>");
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();

    if (sessionAttributes.previousAction === "LaunchRequest") speakOutput = introSound;
    sessionAttributes.previousAction = "Puzzle";

    const response = await httpGet(process.env.airtable_base_data, "&filterByFormula=AND(IsDisabled%3DFALSE(),IsActive%3D1,FIND(%22" + sessionAttributes.user.RecordId + "%22%2C+UserPuzzle)!%3D0)&sort%5B0%5D%5Bfield%5D=GameDate&sort%5B0%5D%5Bdirection%5D=desc&sort%5B1%5D%5Bfield%5D=Order&sort%5B1%5D%5Bdirection%5D=asc&fields%5B%5D=Order&fields%5B%5D=Game&fields%5B%5D=GameDate&fields%5B%5D=Title&fields%5B%5D=VoiceResponse&fields%5B%5D=CardResponse&fields%5B%5D=ScreenResponse&fields%5B%5D=TextResponse&fields%5B%5D=Media&fields%5B%5D=Answer", "Puzzle");
    sessionAttributes.game = response.records;
    if (response.records.length > 0) {
        console.log("CHECKING TO DETERMINE IF TEXT MESSAGE SHOULD BE SENT.");
        if (sessionAttributes.game[0].fields.TextResponse != undefined) await sendTextMessage(sessionAttributes.user.MobileNumber, sessionAttributes.game[0].fields.TextResponse);
        console.log("CHECKING TO DETERMINE IF CARD RESPONSE SHOULD BE SENT.");
        if (sessionAttributes.game[0].fields.CardResponse != undefined) {
            console.log("CHECKING TO DETERMINE IF THERE'S AN IMAGE FOR THE CARD.");
            if (sessionAttributes.game[0].fields.Media != undefined) {
                console.log("SENDING STANDARD CARD.");
                handlerInput.responseBuilder.withStandardCard(sessionAttributes.game[0].fields.GameDate, sessionAttributes.game[0].fields.Title, sessionAttributes.game[0].fields.Media[0].url, sessionAttributes.game[0].fields.Media[0].url);
            }
            else {
                console.log("SENDING SIMPLE CARD.");
                handlerInput.responseBuilder.withSimpleCard(sessionAttributes.game[0].fields.GameDate, sessionAttributes.game[0].fields.Title);
            }
        }
        console.log("CHECKING TO DETERMINE IF THERE'S A SCREEN RESPONSE.");
        if (sessionAttributes.game[0].fields.Media != undefined) {
            console.log("CHECKING TO DETERMINE IF THE USER'S DEVICE SUPPORTS APL.");
            if (supportsAPL(handlerInput)) {
                var apl = require('apl/image.json');
                //TODO: CUSTOMIZE THE APL FOR THE SPECIFIC PUZZLE.
                handlerInput.responseBuilder.addDirective({
                    type: 'Alexa.Presentation.APL.RenderDocument',
                    version: '1.3',
                    document: apl, 
                    datasources: {}
                  })
            }
            //TODO: VERIFY THAT THE USER IS USING A SCREENED DEVICE.
            //TODO: WE NEED TO ADD SOME APL.
        }
        console.log("SENDING VOICE RESPONSE.");
        speakOutput += sessionAttributes.game[0].fields.VoiceResponse;
    }
    else {
        speakOutput += "You've already beaten this week's game!  Congratulations!  Check back in next Saturday for a new challenge!";
    }

    return handlerInput.responseBuilder
        .speak(speakOutput + " What is your answer?")
        .reprompt("What is your answer?")
        .getResponse();
}

const AnswerIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AnswerIntent';
    },
    async handle(handlerInput) {
        console.log("<=== ANSWERINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "AnswerIntent";

        var spokenWords = getSpokenWords(handlerInput, "answer");
        var resolvedWords = getResolvedWords(handlerInput, "answer");
        var puzzleId = sessionAttributes.game[0].id;

        var repromptOutput = "Please try again.";
        var speakOutput = "That is not the correct answer. " + repromptOutput;

        if (resolvedWords != undefined) {
            if (resolvedWords[0].value.id === puzzleId) {
                //TODO: CONGRATULATE THE USER ON GETTING THIS PUZZLE CORRECT.
                //TODO: ADD A RECORD TO THE USER_PUZZLE TABLE FOR THIS USER AND PUZZLE.
                var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
                var record = await new Promise((resolve, reject) => {
                    airtable('UserPuzzle').create({
                        "User": [sessionAttributes.user.RecordId],
                        "Puzzle": [puzzleId],
                        "Answer": spokenWords
                      }, function(err, record) {
                        if (err) {
                          console.error(err);
                          return;
                        }
                        resolve(record);
                      });
                    //SEND THE USER TO THE PUZZLE FUNCTION AGAIN.
                    //speakOutput = ;
                });
                return await PuzzleIntentHandler.handle(handlerInput);
            }
        }
        
        
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(repromptOutput)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        console.log("<=== HELPINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "AMAZON.HelpIntent";
        const speakOutput = "Help Message";

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    async handle(handlerInput) {
        console.log("<=== CANCEL AND STOP INTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = Alexa.getIntentName(handlerInput.requestEnvelope);
        const locale = handlerInput.requestEnvelope.request.locale;
        var speakOutput = await getRandomSpeech("Goodbye", locale);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};
/* *
 * FallbackIntent triggers when a customer says something that doesn’t map to any intents in your skill
 * It must also be defined in the language model (if the locale supports it)
 * This handler can be safely added but will be ingnored in locales that do not support it yet 
 * */
const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        console.log("<=== FALLBACKINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "AMAZON.FallbackIntent";
        const speakOutput = "Fallback Intent";

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};
/* *
 * SessionEndedRequest notifies that a session was ended. This handler will be triggered when a currently open 
 * session is closed for one of the following reasons: 1) The user says "exit" or "quit". 2) The user does not 
 * respond or says something that does not match an intent defined in your voice model. 3) An error occurs 
 * */
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`~~~~ Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse(); // notice we send an empty response
    }
};
/* *
 * The intent reflector is used for interaction model testing and debugging.
 * It will simply repeat the intent the user said. You can create custom handlers for your intents 
 * by defining them above, then also adding them to the request handler chain below 
 * */
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = intentName;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};
/**
 * Generic error handling to capture any syntax or routing errors. If you receive an error
 * stating the request handler chain is not found, you have not implemented a handler for
 * the intent being invoked or included it in the skill builder below 
 * */
const ErrorHandler = {
    canHandle() {
        return true;
    },
    async handle(handlerInput, error) {
        console.log("<=== ERROR HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "ERROR HANDLER";
        const speakOutput = "<audio src='soundbank://soundlibrary/scifi/amzn_sfx_scifi_alarm_03'/>" + Alexa.getRequestType(handlerInput.requestEnvelope);
        console.log(`~~~~ Error handled: ${JSON.stringify(error.stack)}`);
        
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

async function getMobileNumber(handlerInput) {
    try {
        const upsServiceClient = handlerInput.serviceClientFactory.getUpsServiceClient();
        const mobileNumber = await upsServiceClient.getProfileMobileNumber();
        console.log("PHONE NUMBER = " + JSON.stringify(mobileNumber));
        return mobileNumber;
    }
    catch(error) {
        console.log(JSON.stringify(error));
        console.log(JSON.stringify(error.stack));

        if (error.statusCode === 403) {
            return undefined;
        }
    }
}

function fixPhoneNumber(phoneNumber, locale) {
    //TODO: FIX PHONE NUMBERS BASED ON THE LOCALE OF THE USER'S DEVICE.
    if (phoneNumber === undefined) return undefined;
    else if (phoneNumber.length < 10) return undefined;
    else if (phoneNumber.length === 10) return "+1" + phoneNumber;
    else return phoneNumber;
}

async function getEmailAddress(handlerInput) {
    try {
        const upsServiceClient = handlerInput.serviceClientFactory.getUpsServiceClient();
        const emailAddress = await upsServiceClient.getProfileEmail();
        console.log("EMAIL ADDRESS = " + JSON.stringify(emailAddress));
        return emailAddress;
    }
    catch(error) {
        console.log(JSON.stringify(error));
        console.log(JSON.stringify(error.stack));

        if (error.statusCode === 403) {
            return undefined;
        }
    }
}

function supportsAPL(handlerInput) {
    if (handlerInput.requestEnvelope.context.System &&
        handlerInput.requestEnvelope.context.System.device &&
        handlerInput.requestEnvelope.context.System.device.supportedInterfaces &&
        handlerInput.requestEnvelope.context.System.device.supportedInterfaces["Alexa.Presentation.APL"]) return true;
    return false;
}

function askForPermission(handlerInput, type) {
    return handlerInput.responseBuilder
    .speak("You haven't granted me permission to get your " + type + ".  I really need that to play this game.  I have written a card to your Alexa app to make it easy to give me that permission.")
    .withAskForPermissionsConsentCard(PERMISSIONS)
    .getResponse();
}

async function updateUserRecord(handlerInput, phoneNumber = undefined, pin = undefined, isValidated = false) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    var fields = {};
    if (phoneNumber != undefined) fields.MobileNumber = phoneNumber;
    if (pin != undefined) fields.ValidationPin = pin;
    if (isValidated != undefined) fields.IsValidated = isValidated;
    console.log("FIELDS = " + JSON.stringify(fields));

    var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
    var record = await new Promise((resolve, reject) => {
        airtable('User').update([{ 
            "id": sessionAttributes.user.RecordId,
            "fields": fields
        }], function(err, records) {
                if (err) {console.error(err);return;}
                console.log("UPDATED RECORD IN PROMISE = " + JSON.stringify(records[0]));
                resolve(records[0]);
            });
    });
    console.log("UPDATED RECORD = " + JSON.stringify(record));

    sessionAttributes.user = record.fields;
}

function sendTextMessage(phoneNumber, message) {
    console.log("SENDING TEXT MESSAGE. '" + phoneNumber + "', " + message + "'");
    const SNS = new AWS.SNS();
    var parameters = {PhoneNumber: phoneNumber, Message: "From Scavenger Hunt:\n" + message};
    var promise = SNS.publish(parameters).promise();
    promise.then(function(data) {return true;}
    ).catch(function(err){return false;});
    console.log("DONE SENDING TEXT MESSAGE. '" + message + "'");
    return promise;
}

async function getUserRecord(handlerInput) {
    console.log("GETTING USER RECORD");
    var userId = handlerInput.requestEnvelope.session.user.userId;
    //var mobileNumber = await getMobileNumber(handlerInput);
    //mobileNumber = mobileNumber.countryCode + "" + mobileNumber.phoneNumber;
    //console.log("MOBILE NUMBER STRING = " + JSON.stringify(mobileNumber));
    //var emailAddress = await getEmailAddress(handlerInput);


    var filter = "&filterByFormula=%7BUserId%7D%3D%22" + encodeURIComponent(userId) + "%22";
    const userRecord = await httpGet(process.env.airtable_base_data, filter, "User");
    //IF THERE ISN"T A USER RECORD, CREATE ONE.
    if (userRecord.records.length === 0){
        console.log("CREATING NEW USER RECORD");
        var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
        return new Promise((resolve, reject) => {
            airtable("User").create({"UserId": userId}, 
                        function(err, record) {
                                console.log("NEW USER RECORD = " + JSON.stringify(record));
                                if (err) { console.error(err); return; }
                                resolve(record);
                            });
                        });
    }
    else{
        console.log("RETURNING FOUND USER RECORD = " + JSON.stringify(userRecord.records[0]));
        return userRecord.records[0];
        //if (mobileNumber === undefined) mobileNumber = "";
        //if (emailAddress === undefined) emailAddress = "";
        /*
        var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
        return new Promise((resolve, reject) => {
            airtable('User').update([{ 
                "id": userRecord.records[0].fields.RecordId,
                "fields": {
                "MobileNumber": mobileNumber,
                "EmailAddress": emailAddress
                }
            }], function(err, records) {
                    if (err) {console.error(err);return;}
                    resolve(records[0]);
                });
        });
        */
    }
}

function getSpokenWords(handlerInput, slot) {
    if (handlerInput.requestEnvelope
        && handlerInput.requestEnvelope.request
        && handlerInput.requestEnvelope.request.intent
        && handlerInput.requestEnvelope.request.intent.slots
        && handlerInput.requestEnvelope.request.intent.slots[slot]
        && handlerInput.requestEnvelope.request.intent.slots[slot].value)
        return handlerInput.requestEnvelope.request.intent.slots[slot].value;
    else return undefined;
}

function getResolvedWords(handlerInput, slot) {
    if (handlerInput.requestEnvelope
        && handlerInput.requestEnvelope.request
        && handlerInput.requestEnvelope.request.intent
        && handlerInput.requestEnvelope.request.intent.slots
        && handlerInput.requestEnvelope.request.intent.slots[slot]
        && handlerInput.requestEnvelope.request.intent.slots[slot].resolutions
        && handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority
        && handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority[0]
        && handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority[0].values
        && handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority[0].values[0])
        return handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority[0].values
    else return undefined;
}

async function getRandomSpeech(table, locale) {
    const response = await httpGet(process.env.airtable_base_speech, "&filterByFormula=AND(IsDisabled%3DFALSE(),FIND(%22" + locale + "%22%2C+Locale)!%3D0)", table);
    const speech = getRandomItem(response.records);
    console.log("RANDOM [" + table.toUpperCase() + "] = " + JSON.stringify(speech));
    return speech.fields.VoiceResponse;
}

function getRandomItem(items) {
    var random = getRandom(0, items.length-1);
    return items[random];
}

function getRandom(min, max){
    return Math.floor(Math.random() * (max-min+1)+min);
}

function httpGet(base, filter, table = "Data"){
    var options = { host: "api.airtable.com", port: 443, path: "/v0/" + base + "/" + table + "?api_key=" + process.env.airtable_api_key + filter, method: "GET"};
    //console.log("FULL PATH = http://" + options.host + options.path);
    return new Promise(((resolve, reject) => { const request = https.request(options, (response) => { response.setEncoding("utf8");let returnData = "";
        if (response.statusCode < 200 || response.statusCode >= 300) { return reject(new Error(`${response.statusCode}: ${response.req.getHeader("host")} ${response.req.path}`));}
        response.on("data", (chunk) => { returnData += chunk; });
        response.on("end", () => { resolve(JSON.parse(returnData)); });
        response.on("error", (error) => { reject(error);});});
        request.end();
    }));
}

const RequestLog = {
    async process(handlerInput) {
        console.log("REQUEST ENVELOPE = " + JSON.stringify(handlerInput.requestEnvelope));
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        var userRecord = await getUserRecord(handlerInput);
        sessionAttributes.user = userRecord.fields;
        console.log("USER RECORD = " + JSON.stringify(userRecord.fields));
    }
};
  
const ResponseLog = {
    process(handlerInput) {
        console.log("RESPONSE BUILDER = " + JSON.stringify(handlerInput.responseBuilder.getResponse()));   
    }
};
/**
 * This handler acts as the entry point for your skill, routing all request and response
 * payloads to the handlers above. Make sure any new handlers or interceptors you've
 * defined are included below. The order matters - they're processed top to bottom 
 * */
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        PhoneNumberIntentHandler,
        PinValidationIntentHandler,
        AnswerIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(
        ErrorHandler)
    .addRequestInterceptors(RequestLog)
    .addResponseInterceptors(ResponseLog)
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();
