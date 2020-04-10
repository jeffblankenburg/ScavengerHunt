//TODO: Sell hints to puzzles for $1.99?
//TODO: Track a user's progress.  Which puzzle are they currently playing?
//TODO: Do we allow users to play games from previous weeks?  (Maybe this is a "premium" feature, that also includes one hint a week?)
//TODO: What does the first time user experience look like?  We probably need to explain what is happening, and what they should do.
//TODO: Ask for email address or SMS number as alternative ways to deliver clues?  MUST
//TODO: Allow users to change their phone number.

const Alexa = require('ask-sdk-core');
const AWS = require("aws-sdk");
const https = require("https");
const Airtable = require("airtable");
const Twilio = require("twilio")(process.env.twilio_account_sid, process.env.twilio_auth_token);
const PERMISSIONS = ['alexa::profile:name:read', 'alexa::profile:email:read', 'alexa::profile:mobile_number:read'];

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        console.log("<=== " + Alexa.getRequestType(handlerInput.requestEnvelope).toUpperCase() + " HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const locale = handlerInput.requestEnvelope.request.locale;
        var speakOutput = "";
        var welcome = await getRandomSpeech("Welcome", locale);
        var actionQuery = await getRandomSpeech("ActionQuery", locale);
        if (sessionAttributes.user.MobileNumber === undefined && sessionAttributes.user.ValidationPin === undefined) {
            speakOutput = "I noticed that we don't have your mobile number.  This game requires it, because we will send you some of the puzzles as images. ";
            actionQuery = "What is your full mobile phone number?";
        }
        else if (sessionAttributes.user.MobileNumber === undefined && sessionAttributes.user.ValidationPin != undefined) {
            speakOutput = "I have sent you a four digit number to confirm your mobile phone number. ";
            actionQuery = "What is the number that I send to you?";
        }
        else if (sessionAttributes.user.MobileNumber != undefined) {
            speakOutput = " I've sent an image to your Alexa app for the first puzzle.  Good luck! ";
            handlerInput.responseBuilder.withStandardCard("March 30, 2020", "Puzzle #1", "https://s3.us-east-2.amazonaws.com/jeffblankenburg.scavengerhunt/Game1/game1_puzzle1_720x480.png", "https://s3.us-east-2.amazonaws.com/jeffblankenburg.scavengerhunt/Game1/game1_puzzle1_1200x800.png")
        }
        //var mobileNumber = await getMobileNumber(handlerInput);
        //if (mobileNumber === undefined) { return askForPermission(handlerInput, "phone number");}
        //sendTextMessage("Here's your first puzzle.  https://s3.us-east-2.amazonaws.com/jeffblankenburg.scavengerhunt/Game1/game1_puzzle1_1200x800.png")
        speakOutput = welcome + " " + speakOutput + " " + actionQuery;

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
        console.log("<=== " + Alexa.getIntentName(handlerInput.requestEnvelope).toUpperCase() + " HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const locale = handlerInput.requestEnvelope.request.locale;
        var phoneNumber = getSpokenWords(handlerInput, "phoneNumber");
        var speakOutput = "";
        var actionQuery = "";
        phoneNumber = fixPhoneNumber(phoneNumber, locale);
        if (phoneNumber != undefined) {
            var pin = getRandom(1000, 9999);
            await sendTextMessage(phoneNumber, "Your validation PIN for the Scavenger Hunt is " + pin + ". If the skill has closed, you can say \"Alexa, tell Scavenger Hunt my pin is " + pin + "\".");
            var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
            var record = new Promise((resolve, reject) => {
                airtable('User').update([{ 
                    "id": sessionAttributes.user.RecordId,
                    "fields": {
                    "MobileNumber": phoneNumber,
                    "ValidationPin": pin
                    }
                }], function(err, records) {
                        if (err) {console.error(err);return;}
                        resolve(records[0]);
                    });
            });
            speakOutput = "I have sent a message with a four digit PIN to validate your mobile phone number. ";
            actionQuery = "What is that PIN?";
        }
        else {
            speakOutput = "I'm sorry, I didn't get that. ";
            actionQuery = "What is your full mobile phone number?";
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
    handle(handlerInput) {
        console.log("<=== " + Alexa.getIntentName(handlerInput.requestEnvelope).toUpperCase() + " HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const locale = handlerInput.requestEnvelope.request.locale;
        var pin = getSpokenWords(handlerInput, "pin");

        if (sessionAttributes.user.ValidationPin.toString() != pin.toString()) {
            console.log("PIN DIDN'T MATCH.");
            sessionAttributes.user.MobileNumber = undefined;
            sessionAttributes.user.ValidationPin = undefined;
            //TODO: UPDATE USER DATA RECORD IN AIRTABLE TO REMOVE THESE VALUES.
            return LaunchRequestHandler.handle(handlerInput);
        }
        console.log("USER INDICATED THEIR PIN IS " + pin);

        return handlerInput.responseBuilder
            .speak("USER INDICATED THEIR PIN IS " + pin)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

function fixPhoneNumber(phoneNumber, locale) {
    //TODO: FIX PHONE NUMBERS BASED ON THE LOCALE OF THE USER'S DEVICE.
    if (phoneNumber === undefined) return undefined;
    else if (phoneNumber.length < 10) return undefined;
    else if (phoneNumber.length === 10) return "+1" + phoneNumber;
    else return phoneNumber;
}

const HelloWorldIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'HelloWorldIntent';
    },
    handle(handlerInput) {
        const speakOutput = "Hello World";

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
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
        console.log("<=== " + Alexa.getRequestType(handlerInput.requestEnvelope).toUpperCase() + " HANDLER ===>");
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

function askForPermission(handlerInput, type) {
    return handlerInput.responseBuilder
    .speak("You haven't granted me permission to get your " + type + ".  I really need that to play this game.  I have written a card to your Alexa app to make it easy to give me that permission.")
    .withAskForPermissionsConsentCard(PERMISSIONS)
    .getResponse();
}

async function updateUserRecord() {
    var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
    var record = new Promise((resolve, reject) => {
        airtable('User').update([{ 
            "id": sessionAttributes.user.RecordId,
            "fields": {
            "MobileNumber": phoneNumber,
            "ValidationPin": pin
            }
        }], function(err, records) {
                if (err) {console.error(err);return;}
                resolve(records[0]);
            });
    });
}

function sendTextMessage(phoneNumber, message) {
    console.log("SENDING TEXT MESSAGE. '" + message + "'");
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
        HelloWorldIntentHandler,
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
