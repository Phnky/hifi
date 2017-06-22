//
//  fingerPaint.js
//
//  Created by David Rowe on 15 Feb 2017
//  Copyright 2017 High Fidelity, Inc.
//
//  Distributed under the Apache License, Version 2.0.
//  See the accompanying file LICENSE or http://www.apache.org/licenses/LICENSE-2.0.html
//

(function () {
    var tablet,
        button,
        BUTTON_NAME = "PAINT",
        isFingerPainting = false,
        leftHand = null,
        rightHand = null,
        leftBrush = null,
        rightBrush = null,
        isLeftHandDominant = false,
        CONTROLLER_MAPPING_NAME = "com.highfidelity.fingerPaint",
        isTabletDisplayed = false,
        HIFI_POINT_INDEX_MESSAGE_CHANNEL = "Hifi-Point-Index",
        HIFI_GRAB_DISABLE_MESSAGE_CHANNEL = "Hifi-Grab-Disable",
        HIFI_POINTER_DISABLE_MESSAGE_CHANNEL = "Hifi-Pointer-Disable";

        
        
    
    // Set up the qml ui
    var qml = Script.resolvePath('PaintWindow.qml');
    var window = null;
    
    var inkSource = null;
	// Set path for finger paint hand animations 
	var RIGHT_ANIM_URL = Script.resourcesPath() + 'avatar/animations/touch_point_closed_right.fbx';
    var LEFT_ANIM_URL = Script.resourcesPath() + 'avatar/animations/touch_point_closed_left.fbx';
	var RIGHT_ANIM_URL_OPEN = Script.resourcesPath() + 'avatar/animations/touch_point_open_right.fbx';
    var LEFT_ANIM_URL_OPEN = Script.resourcesPath() + 'avatar/animations/touch_point_open_left.fbx'; 
        

    function paintBrush(name) {
        // Paints in 3D.
        var brushName = name,
            STROKE_COLOR = { red: 250, green: 0, blue: 0 },
            ERASE_SEARCH_RADIUS = 0.1,  // m
            STROKE_DIMENSIONS = { x: 10, y: 10, z: 10 },
            isDrawingLine = false,
            entityID,
            basePosition,
            strokePoints,
            strokeNormals,
            strokeWidths,
            timeOfLastPoint,
            texture = null ,
            //'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Caris_Tessellation.svg/1024px-Caris_Tessellation.svg.png', // Daantje
            strokeWidthMultiplier = 0.6,
            MIN_STROKE_LENGTH = 0.005,  // m
            MIN_STROKE_INTERVAL = 66,  // ms
            MAX_POINTS_PER_LINE = 70;  // Hard-coded limit in PolyLineEntityItem.h.
        
        var undo = null;
        
        function strokeNormal() {
            return Vec3.multiplyQbyV(Camera.getOrientation(), Vec3.UNIT_NEG_Z);
        }
        
        function changeStrokeColor(red, green, blue) {
            STROKE_COLOR.red = red;
            STROKE_COLOR.green = green;
            STROKE_COLOR.blue = blue;
        }
        
        function getStrokeColor() {
            return STROKE_COLOR;
        }
        
        function changeStrokeWidthMultiplier(multiplier) {
            strokeWidthMultiplier = multiplier;
        }
        
        function getStrokeWidth() {
            return strokeWidthMultiplier;
        }
        
        function changeTexture(textureURL) {
            texture = textureURL;
        }
        
        function undoErasing() {
            if (undo) {
                Entities.addEntity(undo);
                undo = null;
            }
        }

        function startLine(position, width) {
            // Start drawing a polyline.
            
            width = width * strokeWidthMultiplier;
            
            if (isDrawingLine) {
                print("ERROR: startLine() called when already drawing line");
                // Nevertheless, continue on and start a new line.
            }

            basePosition = position;

            strokePoints = [Vec3.ZERO];
            strokeNormals = [strokeNormal()];
            strokeWidths = [width];
            timeOfLastPoint = Date.now();

            entityID = Entities.addEntity({
                type: "PolyLine",
                name: "fingerPainting",
                color: STROKE_COLOR,
                position: position,
                linePoints: strokePoints,
                normals: strokeNormals,
                strokeWidths: strokeWidths,
                textures: texture, // Daantje
                dimensions: STROKE_DIMENSIONS
            });

            isDrawingLine = true;
        }

        function drawLine(position, width) {
            // Add a stroke to the polyline if stroke is a sufficient length.
            var localPosition,
                distanceToPrevious,
                MAX_DISTANCE_TO_PREVIOUS = 1.0;

            width = width * strokeWidthMultiplier;    
                
            if (!isDrawingLine) {
                print("ERROR: drawLine() called when not drawing line");
                return;
            }

            localPosition = Vec3.subtract(position, basePosition);
            distanceToPrevious = Vec3.distance(localPosition, strokePoints[strokePoints.length - 1]);

            if (distanceToPrevious > MAX_DISTANCE_TO_PREVIOUS) {
                // Ignore occasional spurious finger tip positions.
                return;
            }

            if (distanceToPrevious >= MIN_STROKE_LENGTH
                    && (Date.now() - timeOfLastPoint) >= MIN_STROKE_INTERVAL
                    && strokePoints.length < MAX_POINTS_PER_LINE) {
                strokePoints.push(localPosition);
                strokeNormals.push(strokeNormal());
                strokeWidths.push(width);
                timeOfLastPoint = Date.now();

                Entities.editEntity(entityID, {
                    linePoints: strokePoints,
                    normals: strokeNormals,
                    strokeWidths: strokeWidths
                });
            }
        }

        function finishLine(position, width) {
            // Finish drawing polyline; delete if it has only 1 point.

            width = width * strokeWidthMultiplier;
            
            if (!isDrawingLine) {
                print("ERROR: finishLine() called when not drawing line");
                return;
            }

            if (strokePoints.length === 1) {
                // Delete "empty" line.
                Entities.deleteEntity(entityID);
            }

            isDrawingLine = false;
        }

        function cancelLine() {
            // Cancel any line being drawn.
            if (isDrawingLine) {
                Entities.deleteEntity(entityID);
                isDrawingLine = false;
            }
        }

        function eraseClosestLine(position) {
            // Erase closest line that is within search radius of finger tip.
            var entities,
                entitiesLength,
                properties,
                i,
                pointsLength,
                j,
                distance,
                found = false,
                foundID,
                foundDistance = ERASE_SEARCH_RADIUS;

            // Find entities with bounding box within search radius.
            entities = Entities.findEntities(position, ERASE_SEARCH_RADIUS);

            // Fine polyline entity with closest point within search radius.
            for (i = 0, entitiesLength = entities.length; i < entitiesLength; i += 1) {
                properties = Entities.getEntityProperties(entities[i], ["type", "position", "linePoints"]);
                if (properties.type === "PolyLine") {
                    basePosition = properties.position;
                    for (j = 0, pointsLength = properties.linePoints.length; j < pointsLength; j += 1) {
                        distance = Vec3.distance(position, Vec3.sum(basePosition, properties.linePoints[j]));
                        if (distance <= foundDistance) {
                            found = true;
                            foundID = entities[i];
                            foundDistance = distance;
                        }
                    }
                }
            }

            // Delete found entity.
            if (found) {
                undo = Entities.getEntityProperties(foundID);
                Entities.deleteEntity(foundID);
            }
        }

        function tearDown() {
            cancelLine();
        }

        return {
            startLine: startLine,
            drawLine: drawLine,
            finishLine: finishLine,
            cancelLine: cancelLine,
            eraseClosestLine: eraseClosestLine,
            tearDown: tearDown,
            changeStrokeColor: changeStrokeColor,
            changeStrokeWidthMultiplier: changeStrokeWidthMultiplier,
            changeTexture: changeTexture,
            undoErasing: undoErasing,
            getStrokeColor: getStrokeColor,
            getStrokeWidth: getStrokeWidth
        };
    }

    function handController(name) {
        // Translates controller data into application events.
        var handName = name,

            triggerPressedCallback,
            triggerPressingCallback,
            triggerReleasedCallback,
            gripPressedCallback,

            rawTriggerValue = 0.0,
            triggerValue = 0.0,
            isTriggerPressed = false,
            TRIGGER_SMOOTH_RATIO = 0.1,
            TRIGGER_OFF = 0.05,
            TRIGGER_ON = 0.1,
            TRIGGER_START_WIDTH_RAMP = 0.15,
            TRIGGER_FINISH_WIDTH_RAMP = 1.0,
            TRIGGER_RAMP_WIDTH = TRIGGER_FINISH_WIDTH_RAMP - TRIGGER_START_WIDTH_RAMP,
            MIN_LINE_WIDTH = 0.005,
            MAX_LINE_WIDTH = 0.03,
            RAMP_LINE_WIDTH = MAX_LINE_WIDTH - MIN_LINE_WIDTH,

            rawGripValue = 0.0,
            gripValue = 0.0,
            isGripPressed = false,
            GRIP_SMOOTH_RATIO = 0.1,
            GRIP_OFF = 0.05,
            GRIP_ON = 0.1;

        function onTriggerPress(value) {
            // Controller values are only updated when they change so store latest for use in update.
            rawTriggerValue = value;
            
            
            
            
        }

        function updateTriggerPress(value) {
            
            var LASER_ALPHA = 0.5;
            var LASER_TRIGGER_COLOR_XYZW = {x: 250 / 255, y: 10 / 255, z: 10 / 255, w: LASER_ALPHA};
            var SYSTEM_LASER_DIRECTION = {x: 0, y: 0, z: -1};
            var LEFT_HUD_LASER = 1;
            var RIGHT_HUD_LASER = 2;
            var BOTH_HUD_LASERS = LEFT_HUD_LASER + RIGHT_HUD_LASER;
            if (isLeftHandDominant){
                HMD.setHandLasers(RIGHT_HUD_LASER, true, LASER_TRIGGER_COLOR_XYZW, SYSTEM_LASER_DIRECTION);
                
                HMD.disableHandLasers(LEFT_HUD_LASER);
            }else{
                HMD.setHandLasers(LEFT_HUD_LASER, true, LASER_TRIGGER_COLOR_XYZW, SYSTEM_LASER_DIRECTION);
                HMD.disableHandLasers(RIGHT_HUD_LASER);
                
            }
            HMD.disableExtraLaser();
            
            
            var wasTriggerPressed,
                fingerTipPosition,
                lineWidth;

            triggerValue = triggerValue * TRIGGER_SMOOTH_RATIO + rawTriggerValue * (1.0 - TRIGGER_SMOOTH_RATIO);

            wasTriggerPressed = isTriggerPressed;
            if (isTriggerPressed) {
                isTriggerPressed = triggerValue > TRIGGER_OFF;
            } else {
                isTriggerPressed = triggerValue > TRIGGER_ON;
            }

            if (wasTriggerPressed || isTriggerPressed) {
                fingerTipPosition = MyAvatar.getJointPosition(handName === "left" ? "LeftHandIndex4" : "RightHandIndex4");
                
                opositeHandPosition = MyAvatar.getJointPosition(handName === "left" ? "RightHandMiddle1" : "LeftHandMiddle1");
                
                if (triggerValue < TRIGGER_START_WIDTH_RAMP) {
                    lineWidth = MIN_LINE_WIDTH;
                } else {
                    lineWidth = MIN_LINE_WIDTH
                        + (triggerValue - TRIGGER_START_WIDTH_RAMP) / TRIGGER_RAMP_WIDTH * RAMP_LINE_WIDTH;
                }
                
                if ((handName === "left" && isLeftHandDominant) || (handName === "right" && !isLeftHandDominant)){
                    if (!wasTriggerPressed && isTriggerPressed) {
                        
                        // TEST DAANTJE changes to a random color everytime you start a new line
                        //leftBrush.changeStrokeColor(Math.random()*255, Math.random()*255, Math.random()*255);
                        //rightBrush.changeStrokeColor(Math.random()*255, Math.random()*255, Math.random()*255);
                        // TEST Stroke line width
                        //var dim = Math.random()*4 + +0.5;
                        //var dim2 = Math.floor( Math.random()*40 + 5);
                        //leftBrush.changeStrokeWidthMultiplier(dim);
                        //rightBrush.changeStrokeWidthMultiplier(dim);
                        
                        triggerPressedCallback(fingerTipPosition, lineWidth);
                    } else if (wasTriggerPressed && isTriggerPressed) {
                        triggerPressingCallback(fingerTipPosition, lineWidth);
                    } else {
                        triggerReleasedCallback(fingerTipPosition, lineWidth);
                        
                        /* // define condition to switch dominant hands
                        if (Vec3.length(Vec3.subtract(fingerTipPosition, opositeHandPosition)) < 0.1){
                            isLeftHandDominant = !isLeftHandDominant;
                            
                            // Test DAANTJE changes texture
                            // if (Math.random() > 0.5) {
                                // leftBrush.changeTexture(null);
                                // rightBrush.changeTexture(null);
                            // }else {
                                // leftBrush.changeTexture('http://i.imgur.com/SSWDJtd.png');
                                // rightBrush.changeTexture('https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Caris_Tessellation.svg/1024px-Caris_Tessellation.svg.png');
                            // }
                            
                        } */
                        
                    }
                    
                }
                
            }
            
        }

        function onGripPress(value) {
            // Controller values are only updated when they change so store latest for use in update.
            rawGripValue = value;
        }

        function updateGripPress() {
            var fingerTipPosition;

            gripValue = gripValue * GRIP_SMOOTH_RATIO + rawGripValue * (1.0 - GRIP_SMOOTH_RATIO);

            if (isGripPressed) {
                isGripPressed = gripValue > GRIP_OFF;
            } else {
                isGripPressed = gripValue > GRIP_ON;
                if (isGripPressed) {
                    fingerTipPosition = MyAvatar.getJointPosition(handName === "left" ? "LeftHandIndex4" : "RightHandIndex4");
                    
                    if ((handName === "left" && isLeftHandDominant) || (handName === "right" && !isLeftHandDominant)){
                        gripPressedCallback(fingerTipPosition);
                    }
                }
            }
        }

        function onUpdate() {
            
            //update ink Source
            var strokeColor = leftBrush.getStrokeColor();
            var strokeWidth = leftBrush.getStrokeWidth()*0.06;
            
            var position = MyAvatar.getJointPosition(isLeftHandDominant ? "LeftHandIndex4" : "RightHandIndex4");
            if (inkSource){
                
                
                Entities.editEntity(inkSource, {
                    color : strokeColor,
                    position : position,
                    dimensions : {
                        x: strokeWidth, 
                        y: strokeWidth, 
                        z: strokeWidth} 
                
                });
            } else{
                var inkSourceProps = {
                    type: "Sphere",
                    name: "inkSource",
                    color: strokeColor,
                    position: position,
                    ignoreForCollisions: true,
                    
                    dimensions: {x: strokeWidth, y:strokeWidth, z:strokeWidth}
                }
                inkSource = Entities.addEntity(inkSourceProps);
            }
            
            updateTriggerPress();
            updateGripPress();
        }

        function setUp(onTriggerPressed, onTriggerPressing, onTriggerReleased, onGripPressed) {
            triggerPressedCallback = onTriggerPressed;
            triggerPressingCallback = onTriggerPressing;
            triggerReleasedCallback = onTriggerReleased;
            gripPressedCallback = onGripPressed;
        }

        function tearDown() {
            // Nothing to do.
            //Entities
            if (inkSource){
                Entities.deleteEntity(inkSource);
				inkSource = null;
            }
        }

        return {
            onTriggerPress: onTriggerPress,
            onGripPress: onGripPress,
            onUpdate: onUpdate,
            setUp: setUp,
            tearDown: tearDown
        };
    }

    function updateHandFunctions() {
        // Update other scripts' hand functions.
        var enabled = !isFingerPainting || isTabletDisplayed;

        Messages.sendMessage(HIFI_GRAB_DISABLE_MESSAGE_CHANNEL, JSON.stringify({
            holdEnabled: enabled,
            nearGrabEnabled: enabled,
            farGrabEnabled: enabled
        }), true);
        
        
        Messages.sendMessage(HIFI_POINTER_DISABLE_MESSAGE_CHANNEL, JSON.stringify({
            pointerEnabled: false
        }), true);
        
        //    Messages.sendMessage(HIFI_POINTER_DISABLE_MESSAGE_CHANNEL, JSON.stringify({
        //    pointerEnabled: enabled
        //}), true);
        //}), true);
        
        
        
        Messages.sendMessage(HIFI_POINT_INDEX_MESSAGE_CHANNEL, JSON.stringify({
            pointIndex: !enabled
        }), true);
    }
	
	function updateHandAnimations(){
		var ANIM_URL = (isLeftHandDominant? LEFT_ANIM_URL: RIGHT_ANIM_URL );
		var ANIM_OPEN = (isLeftHandDominant? LEFT_ANIM_URL_OPEN: RIGHT_ANIM_URL_OPEN );
		var handLiteral = (isLeftHandDominant? "left": "right" );

		//Clear previous hand animation override
		restoreAllHandAnimations();
		
		//"rightHandGraspOpen","rightHandGraspClosed",
		MyAvatar.overrideRoleAnimation(handLiteral + "HandGraspOpen", ANIM_OPEN, 30, false, 19, 20);
		MyAvatar.overrideRoleAnimation(handLiteral + "HandGraspClosed", ANIM_URL, 30, false, 19, 20);

		//"rightIndexPointOpen","rightIndexPointClosed",
		MyAvatar.overrideRoleAnimation(handLiteral + "IndexPointOpen", ANIM_OPEN, 30, false, 19, 20);
		MyAvatar.overrideRoleAnimation(handLiteral + "IndexPointClosed", ANIM_URL, 30, false, 19, 20);

		//"rightThumbRaiseOpen","rightThumbRaiseClosed",
		MyAvatar.overrideRoleAnimation(handLiteral + "ThumbRaiseOpen", ANIM_OPEN, 30, false, 19, 20);
		MyAvatar.overrideRoleAnimation(handLiteral + "ThumbRaiseClosed", ANIM_URL, 30, false, 19, 20);

		//"rightIndexPointAndThumbRaiseOpen","rightIndexPointAndThumbRaiseClosed", 
		MyAvatar.overrideRoleAnimation(handLiteral + "IndexPointAndThumbRaiseOpen", ANIM_OPEN, 30, false, 19, 20);
		MyAvatar.overrideRoleAnimation(handLiteral + "IndexPointAndThumbRaiseClosed", ANIM_URL, 30, false, 19, 20);

	}
	
	function restoreAllHandAnimations(){
		//"rightHandGraspOpen","rightHandGraspClosed",
		MyAvatar.restoreRoleAnimation("rightHandGraspOpen");
		MyAvatar.restoreRoleAnimation("rightHandGraspClosed");

		//"rightIndexPointOpen","rightIndexPointClosed",
		MyAvatar.restoreRoleAnimation("rightIndexPointOpen");
		MyAvatar.restoreRoleAnimation("rightIndexPointClosed");

		//"rightThumbRaiseOpen","rightThumbRaiseClosed",
		MyAvatar.restoreRoleAnimation("rightThumbRaiseOpen");
		MyAvatar.restoreRoleAnimation("rightThumbRaiseClosed");

		//"rightIndexPointAndThumbRaiseOpen","rightIndexPointAndThumbRaiseClosed", 
		MyAvatar.restoreRoleAnimation("rightIndexPointAndThumbRaiseOpen");
		MyAvatar.restoreRoleAnimation("rightIndexPointAndThumbRaiseClosed");
		
		//"leftHandGraspOpen","leftHandGraspClosed",
		MyAvatar.restoreRoleAnimation("leftHandGraspOpen");
		MyAvatar.restoreRoleAnimation("leftHandGraspClosed");

		//"leftIndexPointOpen","leftIndexPointClosed",
		MyAvatar.restoreRoleAnimation("leftIndexPointOpen");
		MyAvatar.restoreRoleAnimation("leftIndexPointClosed");

		//"leftThumbRaiseOpen","leftThumbRaiseClosed",
		MyAvatar.restoreRoleAnimation("leftThumbRaiseOpen");
		MyAvatar.restoreRoleAnimation("leftThumbRaiseClosed");

		//"leftIndexPointAndThumbRaiseOpen","leftIndexPointAndThumbRaiseClosed", 
		MyAvatar.restoreRoleAnimation("leftIndexPointAndThumbRaiseOpen");
		MyAvatar.restoreRoleAnimation("leftIndexPointAndThumbRaiseClosed");
	}
	
    function enableProcessing() {
        // Connect controller API to handController objects.
        leftHand = handController("left");
        rightHand = handController("right");
		
		//Change to finger paint hand animation
		updateHandAnimations();
		
        var controllerMapping = Controller.newMapping(CONTROLLER_MAPPING_NAME);
        controllerMapping.from(Controller.Standard.LT).to(leftHand.onTriggerPress);
        controllerMapping.from(Controller.Standard.LeftGrip).to(leftHand.onGripPress);
        controllerMapping.from(Controller.Standard.RT).to(rightHand.onTriggerPress);
        controllerMapping.from(Controller.Standard.RightGrip).to(rightHand.onGripPress);
        Controller.enableMapping(CONTROLLER_MAPPING_NAME);

        // Connect handController outputs to paintBrush objects.
        leftBrush = paintBrush("left");
        leftHand.setUp(leftBrush.startLine, leftBrush.drawLine, leftBrush.finishLine, leftBrush.eraseClosestLine);
        rightBrush = paintBrush("right");
        rightHand.setUp(rightBrush.startLine, rightBrush.drawLine, rightBrush.finishLine, rightBrush.eraseClosestLine);

        // Messages channels for enabling/disabling other scripts' functions.
        Messages.subscribe(HIFI_POINT_INDEX_MESSAGE_CHANNEL);
        Messages.subscribe(HIFI_GRAB_DISABLE_MESSAGE_CHANNEL);
        Messages.subscribe(HIFI_POINTER_DISABLE_MESSAGE_CHANNEL);

        // Update hand controls.
        Script.update.connect(leftHand.onUpdate);
        Script.update.connect(rightHand.onUpdate);
        
		
        // enable window palette
        window = new OverlayWindow({
            title: 'Paint Window',
            source: qml,
            width: 600, height: 600,
        });
        
        // 75
        //50
        window.setPosition(75, 100);
        //window.closed.connect(function() { 
        //Script.stop(); 
        //});

        window.fromQml.connect(function(message){
            if (message[0] === "color"){
                leftBrush.changeStrokeColor(message[1], message[2], message[3]);
                rightBrush.changeStrokeColor(message[1], message[2], message[3]);
                return;
            }
            if (message[0] === "width"){
                var dim = message[1]*2 +0.1;
                //var dim2 = Math.floor( Math.random()*40 + 5);
                leftBrush.changeStrokeWidthMultiplier(dim);
                rightBrush.changeStrokeWidthMultiplier(dim);
                return;
            }
            if (message[0] === "brush"){
                
                //var dim2 = Math.floor( Math.random()*40 + 5);
                leftBrush.changeTexture(message[1]);
                rightBrush.changeTexture(message[1]);
                return;
            }
            if (message[0] === "undo"){
                leftBrush.undoErasing();
                rightBrush.undoErasing();
                return;
            }
            if (message[0] === "hand"){
                isLeftHandDominant = !isLeftHandDominant;
				updateHandAnimations();
                return;
            }
        });

        
    }

    function disableProcessing() {
        Script.update.disconnect(leftHand.onUpdate);
        Script.update.disconnect(rightHand.onUpdate);

        Controller.disableMapping(CONTROLLER_MAPPING_NAME);

        leftBrush.tearDown();
        leftBrush = null;
        leftHand.tearDown();
        leftHand = null;

        rightBrush.tearDown();
        rightBrush = null;
        rightHand.tearDown();
        rightHand = null;

        Messages.unsubscribe(HIFI_POINT_INDEX_MESSAGE_CHANNEL);
        Messages.unsubscribe(HIFI_GRAB_DISABLE_MESSAGE_CHANNEL);
        Messages.unsubscribe(HIFI_POINTER_DISABLE_MESSAGE_CHANNEL);
        
		
		//Restores and clears hand animations
		restoreAllHandAnimations();
		
        // disable window palette
        window.close();
    }

    function onButtonClicked() {
        var wasFingerPainting = isFingerPainting;

        isFingerPainting = !isFingerPainting;
        button.editProperties({ isActive: isFingerPainting });

        print("Finger painting: " + isFingerPainting ? "on" : "off");

        if (wasFingerPainting) {
            leftBrush.cancelLine();
            rightBrush.cancelLine();
        }

        if (isFingerPainting) {
            enableProcessing();
        }

        updateHandFunctions();

        if (!isFingerPainting) {
            disableProcessing();
        }
    }

    function onTabletScreenChanged(type, url) {
        var TABLET_SCREEN_CLOSED = "Closed";

        isTabletDisplayed = type !== TABLET_SCREEN_CLOSED;
        updateHandFunctions();
    }

    function setUp() {
        tablet = Tablet.getTablet("com.highfidelity.interface.tablet.system");
        if (!tablet) {
            return;
        }

        // Tablet button.
        button = tablet.addButton({
            icon: "icons/tablet-icons/finger-paint-i.svg",
            activeIcon: "icons/tablet-icons/finger-paint-a.svg",
            text: BUTTON_NAME,
            isActive: isFingerPainting
        });
        button.clicked.connect(onButtonClicked);

        // Track whether tablet is displayed or not.
        tablet.screenChanged.connect(onTabletScreenChanged);
    }

    function tearDown() {
        if (!tablet) {
            return;
        }

        if (isFingerPainting) {
            isFingerPainting = false;
            updateHandFunctions();
            disableProcessing();
        }

        tablet.screenChanged.disconnect(onTabletScreenChanged);

        button.clicked.disconnect(onButtonClicked);
        tablet.removeButton(button);
    }

    setUp();
    Script.scriptEnding.connect(tearDown);
    
    

    
    
}());