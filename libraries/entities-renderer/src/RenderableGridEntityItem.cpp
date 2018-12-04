//
//  Created by Sam Gondelman on 11/29/18
//  Copyright 2018 High Fidelity, Inc.
//
//  Distributed under the Apache License, Version 2.0.
//  See the accompanying file LICENSE or http://www.apache.org/licenses/LICENSE-2.0.html
//

#include "RenderableGridEntityItem.h"

#include <DependencyManager.h>
#include <GeometryCache.h>

using namespace render;
using namespace render::entities;

GridEntityRenderer::GridEntityRenderer(const EntityItemPointer& entity) : Parent(entity) {
    _geometryId = DependencyManager::get<GeometryCache>()->allocateID();
}

GridEntityRenderer::~GridEntityRenderer() {
    auto geometryCache = DependencyManager::get<GeometryCache>();
    if (geometryCache) {
        geometryCache->releaseID(_geometryId);
    }
}

bool GridEntityRenderer::isTransparent() const {
    return Parent::isTransparent() || _alpha < 1.0f;
}

bool GridEntityRenderer::needsRenderUpdate() const {
    return Parent::needsRenderUpdate();
}

bool GridEntityRenderer::needsRenderUpdateFromTypedEntity(const TypedEntityPointer& entity) const {
    bool needsUpdate = resultWithReadLock<bool>([&] {
        if (_color != entity->getColor()) {
            return true;
        }

        if (_alpha != entity->getAlpha()) {
            return true;
        }

        if (_followCamera != entity->getFollowCamera()) {
            return true;
        }

        if (_majorGridEvery != entity->getMajorGridEvery()) {
            return true;
        }

        if (_minorGridEvery != entity->getMinorGridEvery()) {
            return true;
        }

        return false;
    });

    return needsUpdate;
}

void GridEntityRenderer::doRenderUpdateSynchronousTyped(const ScenePointer& scene, Transaction& transaction, const TypedEntityPointer& entity) {
    withWriteLock([&] {
        _color = entity->getColor();
        _alpha = entity->getAlpha();

        _followCamera = entity->getFollowCamera();
        _majorGridEvery = entity->getMajorGridEvery();
        _minorGridEvery = entity->getMinorGridEvery();
    });

    void* key = (void*)this;
    AbstractViewStateInterface::instance()->pushPostUpdateLambda(key, [this, entity]() {
        withWriteLock([&] {
            _dimensions = entity->getScaledDimensions();
            updateModelTransformAndBound();
            _renderTransform = getModelTransform();
        });
    });
}

Item::Bound GridEntityRenderer::getBound() {
    if (_followCamera) {
        // This is a UI element that should always be in view, lie to the octree to avoid culling
        const AABox DOMAIN_BOX = AABox(glm::vec3(-TREE_SCALE / 2), TREE_SCALE);
        return DOMAIN_BOX;
    }
    return Parent::getBound();
}

ShapeKey GridEntityRenderer::getShapeKey() {
    return render::ShapeKey::Builder().withOwnPipeline().withUnlit().withDepthBias();
}

void GridEntityRenderer::doRender(RenderArgs* args) {
    glm::u8vec3 color;
    glm::vec3 dimensions;
    Transform renderTransform;
    withReadLock([&] {
        color = _color;
        dimensions = _dimensions;
        renderTransform = _renderTransform;
    });

    if (!_visible) {
        return;
    }

    auto batch = args->_batch;

    Transform transform;
    transform.setScale(dimensions);
    transform.setRotation(renderTransform.getRotation());
    if (_followCamera) {
        // Get the camera position rounded to the nearest major grid line
        // This grid is for UI and should lie on worldlines
        glm::vec3 localCameraPosition = glm::inverse(transform.getRotation()) * args->getViewFrustum().getPosition();
        localCameraPosition.z = 0;
        localCameraPosition = (float)_majorGridEvery * glm::round(localCameraPosition / (float)_majorGridEvery);
        transform.setTranslation(renderTransform.getTranslation() + transform.getRotation() * localCameraPosition);
    } else {
        transform.setTranslation(renderTransform.getTranslation());
    }
    batch->setModelTransform(transform);

    auto minCorner = glm::vec2(-0.5f, -0.5f);
    auto maxCorner = glm::vec2(0.5f, 0.5f);
    float majorGridRowDivisions = dimensions.x / _majorGridEvery;
    float majorGridColDivisions = dimensions.y / _majorGridEvery;
    float minorGridRowDivisions = dimensions.x / _minorGridEvery;
    float minorGridColDivisions = dimensions.y / _minorGridEvery;
    glm::vec4 gridColor(toGlm(color), _alpha);

    const float MINOR_GRID_EDGE = 0.0025f;
    const float MAJOR_GRID_EDGE = 0.005f;
    // FIXME: add layered props to entities
    const float LAYERED = false;
    DependencyManager::get<GeometryCache>()->renderGrid(*batch, minCorner, maxCorner,
        minorGridRowDivisions, minorGridColDivisions, MINOR_GRID_EDGE,
        majorGridRowDivisions, majorGridColDivisions, MAJOR_GRID_EDGE,
        gridColor, LAYERED, _geometryId);
}