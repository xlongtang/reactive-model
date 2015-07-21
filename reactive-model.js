(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  global.ReactiveModel = factory();
}(this, function () { 'use strict';

  // A graph data structure with depth-first search.
  function Graph(){
    
    // The adjacency list of the graph.
    // Keys are node ids.
    // Values are adjacent node id arrays.
    var edges = {};

    // Gets or creates the adjacent node list for node u.
    function adjacent(u){
      return edges[u] || (edges[u] = []);
    }

    function addEdge(u, v){
      adjacent(u).push(v);
    }

    // TODO test this function
    //function removeEdge(u, v){
    //  if(edges[u]) {
    //    edges[u] = edges[u]
    //  }
    //  adjacent(u).push(v);
    //}

    // Depth First Search algorithm, inspired by
    // Cormen et al. "Introduction to Algorithms" 3rd Ed. p. 604
    function DFS(sourceNodes, shouldVisit){

      var visited = {};
      var nodes = [];

      if(!shouldVisit){
        shouldVisit = function (node) { return true; };
      }

      sourceNodes.forEach(function DFSVisit(node){
        if(!visited[node] && shouldVisit(node)){
          visited[node] = true;
          adjacent(node).forEach(DFSVisit);
          nodes.push(node);
        }
      });

      return nodes;
    }
    
    return {
      adjacent: adjacent,
      addEdge: addEdge,
      //removeEdge: removeEdge,
      DFS: DFS
    };
  }

  function ReactiveGraph(){
    var reactiveGraph = new Graph();

    // { node -> getterSetter }
    var getterSetters = {};

    // { node -> λ }
    var reactiveFunctions = {};

    // { node -> true }
    var changedPropertyNodes = {};
    
    var nodeCounter = 0;

    function makeNode(){
      return nodeCounter++;
    }

    function makePropertyNode(getterSetter){
      var node = makeNode();
      getterSetters[node] = getterSetter;
      return node;
    }

    function makeReactiveFunctionNode(λ){
      var node = makeNode();
      reactiveFunctions[node] = λ;
      return node;
    }

    function addReactiveFunction(λ){

      if( (λ.inNodes === undefined) || (λ.outNode === undefined) ){
          throw new Error("Attempting to add a reactive function that " +
            "doesn't have inNodes or outNode defined first.");
      }

      λ.inNodes.forEach(function (inNode){
        reactiveGraph.addEdge(inNode, λ.node);
      });

      reactiveGraph.addEdge(λ.node, λ.outNode);
    }

    function evaluate(λ){
      var inValues = λ.inNodes.map(getPropertyNodeValue);
      if(inValues.every(isDefined)){
        var outValue = λ.callback.apply(null, inValues);
        getterSetters[λ.outNode](outValue);
      }
    }

    function isDefined(value){
      return !(typeof value === "undefined" || value === null);
    }

    function getPropertyNodeValue(node){
      return getterSetters[node]();
    }

    function digest(){
    
      var sourceNodes = Object.keys(changedPropertyNodes);
      var visitedNodes = reactiveGraph.DFS(sourceNodes);
      var topologicallySorted = visitedNodes.reverse();

      topologicallySorted.forEach(function (node){
        if(node in reactiveFunctions){
          evaluate(reactiveFunctions[node]);
        }
      });

      sourceNodes.forEach(function(node){
        delete changedPropertyNodes[node];
      });
    }

    function propertyNodeDidChange(node){
      changedPropertyNodes[node] = true;

      // TODO add this:
      // scheduleDigestOnNextFrame();
    }

    reactiveGraph.addReactiveFunction      = addReactiveFunction;
    reactiveGraph.makeNode                 = makeNode;
    reactiveGraph.digest                   = digest;
    reactiveGraph.makePropertyNode         = makePropertyNode;
    reactiveGraph.makeReactiveFunctionNode = makeReactiveFunctionNode;
    reactiveGraph.propertyNodeDidChange    = propertyNodeDidChange;

    return reactiveGraph;
  }


  // This file serves to document the reactive function data structure,
  // and contains a utility function for parsing the options passed to model.react().
  function ReactiveFunction(inProperties, outProperty, callback){
    var λ = {

      // An array of input property names.
      inProperties: inProperties,

      // The output property name.
      outProperty: outProperty,

      // function (inPropertyValues) -> outPropertyValue
      // Invoked during a digest,
      //   - when all input property values are first defined,
      //   - in response to any changes in input property values.
      callback: callback,

      // inNodes and outNodes are populated in the function reactiveModel.assignNodes(),
      // which is invoked after the original ReactiveFunction object is created.

      // An array of node id strings corresponding
      // to the property names in inProperties.
      inNodes: undefined,

      // The node id string corresponding to the output property.
      outNode: undefined
    };

    return λ;
  }

  // This function parses the options object passed into `model.react(options)`,
  // transforming it into an array of ReactiveFunction instances.
  ReactiveFunction.parse = function (options){
    return Object.keys(options).map(function (outProperty){
      var array = options[outProperty];
      var callback = array.splice(array.length - 1)[0];
      var inProperties = array;
      return ReactiveFunction(inProperties, outProperty, callback);
    });
  };

  var reactiveGraph = new ReactiveGraph();

  var addReactiveFunction      = reactiveGraph.addReactiveFunction;
  var makePropertyNode         = reactiveGraph.makePropertyNode;
  var makeReactiveFunctionNode = reactiveGraph.makeReactiveFunctionNode;
  var propertyNodeDidChange    = reactiveGraph.propertyNodeDidChange;

  function ReactiveModel(){
    
    // Enforce use of new, so instanceof and typeof checks will always work.
    if (!(this instanceof ReactiveModel)) {
      return new ReactiveModel();
    }

    // Refer to `this` (the ReactiveModel instance) as `model` in this closure.
    var model = this;

    // { property -> defaultValue }
    var publicProperties = {};

    // { property -> value }
    var values = {};

    // { property -> node }
    var trackedProperties = {};

    var isFinalized = false;

    function addPublicProperty(property, defaultValue){
      if(isFinalized){
        throw new Error("model.addPublicProperty() is being " +
          "invoked after model.finalize, but this is not allowed. "+
          "Public properties may only be added before the model is finalized.");
      }

      // TODO test this
      // if(isDefined(defaultValue)){
      //  throw new Error("model.addPublicProperty() is being " +
      //    "invoked with an undefined default value. Default values for public properties " +
      //    "must be defined, to guarantee predictable behavior. For public properties that " +
      //    "are optional and should have the semantics of an undefined value, " +
      //    "use ReactiveModel.NONE as the default value.");
      //}

      publicProperties[property] = defaultValue;

      return model;
    }

    function getDefaultValue(property){
      return publicProperties[property];
    }

    function finalize(){
      if(isFinalized){
        throw new Error("model.finalize() is being invoked " +
          "more than once, but this function should only be invoked once.");
      }
      isFinalized = true;

      Object.keys(publicProperties).forEach(function(property){
        track(property);
        model[property](getDefaultValue(property));
      });

      return model;
    }

    function getState(){
      var state = {};
      Object.keys(publicProperties).forEach( function (publicProperty){
        state[publicProperty] = values[publicProperty];
      });
      return state;
    }

    function setState(state){

      // TODO throw an error if some property in state
      // is not in publicProperties
      //Object.keys(state).forEach(function (property){
      //  if(!property in publicProperties){
      //    throw new Error("Attempting to set a property that has not" +
      //      " been added as a public property in model.setState()");
      //  }
      //});

      // Reset state to default values.
      Object.keys(publicProperties).forEach(function (property){
        var defaultValue = publicProperties[property];
        model[property](defaultValue);
      });

      // Apply values included in the new state.
      Object.keys(state).forEach(function (property){
        var newValue = state[property]
        model[property](newValue);
      });

      return model;
    }

    function react(options){
      ReactiveFunction.parse(options).forEach(function (λ){
        assignNodes(λ);
        addReactiveFunction(λ);
      });
    }

    function assignNodes(λ){
      λ.inNodes = λ.inProperties.map(track);
      λ.node = makeReactiveFunctionNode(λ);
      λ.outNode = track(λ.outProperty);
    }

    function track(property){
      if(property in trackedProperties){
        return trackedProperties[property];
      } else {
        var getterSetter = createGetterSetter(property);
        var propertyNode = makePropertyNode(getterSetter);
        model[property] = getterSetter;
        trackedProperties[property] = propertyNode;
        return propertyNode;
      }
    }

    function createGetterSetter(property){
      return function (value){
        if (!arguments.length) {
          return values[property];
        }
        values[property] = value;
        propertyDidChange(property);
        return model;
      };
    }

    function propertyDidChange(property){
      var propertyNode = trackedProperties[property];
      propertyNodeDidChange(propertyNode);
    }

    model.addPublicProperty = addPublicProperty;
    model.finalize = finalize;
    model.getState = getState;
    model.setState = setState;
    model.react = react;
  }

  ReactiveModel.digest = reactiveGraph.digest;

  // Export these internal modules for unit testing via Rollup CommonJS build.
  ReactiveModel.Graph = Graph;
  ReactiveModel.ReactiveGraph = ReactiveGraph;
  ReactiveModel.ReactiveFunction = ReactiveFunction;

  var reactiveModel = ReactiveModel;

  return reactiveModel;

}));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVhY3RpdmUtbW9kZWwuanMiLCJzb3VyY2VzIjpbIi9Vc2Vycy9jdXJyYW4vcmVwb3MvcmVhY3RpdmUtbW9kZWwvc3JjL2dyYXBoLmpzIiwiL1VzZXJzL2N1cnJhbi9yZXBvcy9yZWFjdGl2ZS1tb2RlbC9zcmMvcmVhY3RpdmVHcmFwaC5qcyIsIi9Vc2Vycy9jdXJyYW4vcmVwb3MvcmVhY3RpdmUtbW9kZWwvc3JjL3JlYWN0aXZlRnVuY3Rpb24uanMiLCIvVXNlcnMvY3VycmFuL3JlcG9zL3JlYWN0aXZlLW1vZGVsL3NyYy9yZWFjdGl2ZU1vZGVsLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIEEgZ3JhcGggZGF0YSBzdHJ1Y3R1cmUgd2l0aCBkZXB0aC1maXJzdCBzZWFyY2guXG5mdW5jdGlvbiBHcmFwaCgpe1xuICBcbiAgLy8gVGhlIGFkamFjZW5jeSBsaXN0IG9mIHRoZSBncmFwaC5cbiAgLy8gS2V5cyBhcmUgbm9kZSBpZHMuXG4gIC8vIFZhbHVlcyBhcmUgYWRqYWNlbnQgbm9kZSBpZCBhcnJheXMuXG4gIHZhciBlZGdlcyA9IHt9O1xuXG4gIC8vIEdldHMgb3IgY3JlYXRlcyB0aGUgYWRqYWNlbnQgbm9kZSBsaXN0IGZvciBub2RlIHUuXG4gIGZ1bmN0aW9uIGFkamFjZW50KHUpe1xuICAgIHJldHVybiBlZGdlc1t1XSB8fCAoZWRnZXNbdV0gPSBbXSk7XG4gIH1cblxuICBmdW5jdGlvbiBhZGRFZGdlKHUsIHYpe1xuICAgIGFkamFjZW50KHUpLnB1c2godik7XG4gIH1cblxuICAvLyBUT0RPIHRlc3QgdGhpcyBmdW5jdGlvblxuICAvL2Z1bmN0aW9uIHJlbW92ZUVkZ2UodSwgdil7XG4gIC8vICBpZihlZGdlc1t1XSkge1xuICAvLyAgICBlZGdlc1t1XSA9IGVkZ2VzW3VdXG4gIC8vICB9XG4gIC8vICBhZGphY2VudCh1KS5wdXNoKHYpO1xuICAvL31cblxuICAvLyBEZXB0aCBGaXJzdCBTZWFyY2ggYWxnb3JpdGhtLCBpbnNwaXJlZCBieVxuICAvLyBDb3JtZW4gZXQgYWwuIFwiSW50cm9kdWN0aW9uIHRvIEFsZ29yaXRobXNcIiAzcmQgRWQuIHAuIDYwNFxuICBmdW5jdGlvbiBERlMoc291cmNlTm9kZXMsIHNob3VsZFZpc2l0KXtcblxuICAgIHZhciB2aXNpdGVkID0ge307XG4gICAgdmFyIG5vZGVzID0gW107XG5cbiAgICBpZighc2hvdWxkVmlzaXQpe1xuICAgICAgc2hvdWxkVmlzaXQgPSBmdW5jdGlvbiAobm9kZSkgeyByZXR1cm4gdHJ1ZTsgfTtcbiAgICB9XG5cbiAgICBzb3VyY2VOb2Rlcy5mb3JFYWNoKGZ1bmN0aW9uIERGU1Zpc2l0KG5vZGUpe1xuICAgICAgaWYoIXZpc2l0ZWRbbm9kZV0gJiYgc2hvdWxkVmlzaXQobm9kZSkpe1xuICAgICAgICB2aXNpdGVkW25vZGVdID0gdHJ1ZTtcbiAgICAgICAgYWRqYWNlbnQobm9kZSkuZm9yRWFjaChERlNWaXNpdCk7XG4gICAgICAgIG5vZGVzLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gbm9kZXM7XG4gIH1cbiAgXG4gIHJldHVybiB7XG4gICAgYWRqYWNlbnQ6IGFkamFjZW50LFxuICAgIGFkZEVkZ2U6IGFkZEVkZ2UsXG4gICAgLy9yZW1vdmVFZGdlOiByZW1vdmVFZGdlLFxuICAgIERGUzogREZTXG4gIH07XG59XG5leHBvcnQgZGVmYXVsdCBHcmFwaDtcbiIsIi8vIEEgZ3JhcGggZGF0YSBzdHJ1Y3R1cmUgdGhhdCByZXByZXNlbnRzIGEgZGF0YSBkZXBlbmRlbmN5IGdyYXBoLlxuLy8gTm9kZXMgcmVwcmVzZW50IHByb3BlcnRpZXMgb2YgcmVhY3RpdmUgbW9kZWxzIGFuZCByZWFjdGl2ZSBmdW5jdGlvbnMuXG4vLyBFZGdlcyByZXByZXNlbnQgcmVhY3RpdmUgZGVwZW5kZW5jaWVzLlxuXG4vLyBBIHNpbmdsZSBpbnN0YW5jZSBvZiBSZWFjdGl2ZUdyYXBoIGNvbnRhaW5zIG5vZGVzIGZvciBwcm9wZXJ0aWVzXG4vLyBmcm9tIG1hbnkgZGlmZmVyZW50IGluc3RhbmNlcyBvZiBSZWFjdGl2ZU1vZGVsLlxuXG5pbXBvcnQgR3JhcGggZnJvbSBcIi4vZ3JhcGhcIjtcblxuZnVuY3Rpb24gUmVhY3RpdmVHcmFwaCgpe1xuICB2YXIgcmVhY3RpdmVHcmFwaCA9IG5ldyBHcmFwaCgpO1xuXG4gIC8vIHsgbm9kZSAtPiBnZXR0ZXJTZXR0ZXIgfVxuICB2YXIgZ2V0dGVyU2V0dGVycyA9IHt9O1xuXG4gIC8vIHsgbm9kZSAtPiDOuyB9XG4gIHZhciByZWFjdGl2ZUZ1bmN0aW9ucyA9IHt9O1xuXG4gIC8vIHsgbm9kZSAtPiB0cnVlIH1cbiAgdmFyIGNoYW5nZWRQcm9wZXJ0eU5vZGVzID0ge307XG4gIFxuICB2YXIgbm9kZUNvdW50ZXIgPSAwO1xuXG4gIGZ1bmN0aW9uIG1ha2VOb2RlKCl7XG4gICAgcmV0dXJuIG5vZGVDb3VudGVyKys7XG4gIH1cblxuICBmdW5jdGlvbiBtYWtlUHJvcGVydHlOb2RlKGdldHRlclNldHRlcil7XG4gICAgdmFyIG5vZGUgPSBtYWtlTm9kZSgpO1xuICAgIGdldHRlclNldHRlcnNbbm9kZV0gPSBnZXR0ZXJTZXR0ZXI7XG4gICAgcmV0dXJuIG5vZGU7XG4gIH1cblxuICBmdW5jdGlvbiBtYWtlUmVhY3RpdmVGdW5jdGlvbk5vZGUozrspe1xuICAgIHZhciBub2RlID0gbWFrZU5vZGUoKTtcbiAgICByZWFjdGl2ZUZ1bmN0aW9uc1tub2RlXSA9IM67O1xuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgZnVuY3Rpb24gYWRkUmVhY3RpdmVGdW5jdGlvbijOuyl7XG5cbiAgICBpZiggKM67LmluTm9kZXMgPT09IHVuZGVmaW5lZCkgfHwgKM67Lm91dE5vZGUgPT09IHVuZGVmaW5lZCkgKXtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0ZW1wdGluZyB0byBhZGQgYSByZWFjdGl2ZSBmdW5jdGlvbiB0aGF0IFwiICtcbiAgICAgICAgICBcImRvZXNuJ3QgaGF2ZSBpbk5vZGVzIG9yIG91dE5vZGUgZGVmaW5lZCBmaXJzdC5cIik7XG4gICAgfVxuXG4gICAgzrsuaW5Ob2Rlcy5mb3JFYWNoKGZ1bmN0aW9uIChpbk5vZGUpe1xuICAgICAgcmVhY3RpdmVHcmFwaC5hZGRFZGdlKGluTm9kZSwgzrsubm9kZSk7XG4gICAgfSk7XG5cbiAgICByZWFjdGl2ZUdyYXBoLmFkZEVkZ2Uozrsubm9kZSwgzrsub3V0Tm9kZSk7XG4gIH1cblxuICBmdW5jdGlvbiBldmFsdWF0ZSjOuyl7XG4gICAgdmFyIGluVmFsdWVzID0gzrsuaW5Ob2Rlcy5tYXAoZ2V0UHJvcGVydHlOb2RlVmFsdWUpO1xuICAgIGlmKGluVmFsdWVzLmV2ZXJ5KGlzRGVmaW5lZCkpe1xuICAgICAgdmFyIG91dFZhbHVlID0gzrsuY2FsbGJhY2suYXBwbHkobnVsbCwgaW5WYWx1ZXMpO1xuICAgICAgZ2V0dGVyU2V0dGVyc1vOuy5vdXROb2RlXShvdXRWYWx1ZSk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaXNEZWZpbmVkKHZhbHVlKXtcbiAgICByZXR1cm4gISh0eXBlb2YgdmFsdWUgPT09IFwidW5kZWZpbmVkXCIgfHwgdmFsdWUgPT09IG51bGwpO1xuICB9XG5cbiAgZnVuY3Rpb24gZ2V0UHJvcGVydHlOb2RlVmFsdWUobm9kZSl7XG4gICAgcmV0dXJuIGdldHRlclNldHRlcnNbbm9kZV0oKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGRpZ2VzdCgpe1xuICBcbiAgICB2YXIgc291cmNlTm9kZXMgPSBPYmplY3Qua2V5cyhjaGFuZ2VkUHJvcGVydHlOb2Rlcyk7XG4gICAgdmFyIHZpc2l0ZWROb2RlcyA9IHJlYWN0aXZlR3JhcGguREZTKHNvdXJjZU5vZGVzKTtcbiAgICB2YXIgdG9wb2xvZ2ljYWxseVNvcnRlZCA9IHZpc2l0ZWROb2Rlcy5yZXZlcnNlKCk7XG5cbiAgICB0b3BvbG9naWNhbGx5U29ydGVkLmZvckVhY2goZnVuY3Rpb24gKG5vZGUpe1xuICAgICAgaWYobm9kZSBpbiByZWFjdGl2ZUZ1bmN0aW9ucyl7XG4gICAgICAgIGV2YWx1YXRlKHJlYWN0aXZlRnVuY3Rpb25zW25vZGVdKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHNvdXJjZU5vZGVzLmZvckVhY2goZnVuY3Rpb24obm9kZSl7XG4gICAgICBkZWxldGUgY2hhbmdlZFByb3BlcnR5Tm9kZXNbbm9kZV07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcm9wZXJ0eU5vZGVEaWRDaGFuZ2Uobm9kZSl7XG4gICAgY2hhbmdlZFByb3BlcnR5Tm9kZXNbbm9kZV0gPSB0cnVlO1xuXG4gICAgLy8gVE9ETyBhZGQgdGhpczpcbiAgICAvLyBzY2hlZHVsZURpZ2VzdE9uTmV4dEZyYW1lKCk7XG4gIH1cblxuICByZWFjdGl2ZUdyYXBoLmFkZFJlYWN0aXZlRnVuY3Rpb24gICAgICA9IGFkZFJlYWN0aXZlRnVuY3Rpb247XG4gIHJlYWN0aXZlR3JhcGgubWFrZU5vZGUgICAgICAgICAgICAgICAgID0gbWFrZU5vZGU7XG4gIHJlYWN0aXZlR3JhcGguZGlnZXN0ICAgICAgICAgICAgICAgICAgID0gZGlnZXN0O1xuICByZWFjdGl2ZUdyYXBoLm1ha2VQcm9wZXJ0eU5vZGUgICAgICAgICA9IG1ha2VQcm9wZXJ0eU5vZGU7XG4gIHJlYWN0aXZlR3JhcGgubWFrZVJlYWN0aXZlRnVuY3Rpb25Ob2RlID0gbWFrZVJlYWN0aXZlRnVuY3Rpb25Ob2RlO1xuICByZWFjdGl2ZUdyYXBoLnByb3BlcnR5Tm9kZURpZENoYW5nZSAgICA9IHByb3BlcnR5Tm9kZURpZENoYW5nZTtcblxuICByZXR1cm4gcmVhY3RpdmVHcmFwaDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgUmVhY3RpdmVHcmFwaDtcbiIsIi8vIFRoaXMgZmlsZSBzZXJ2ZXMgdG8gZG9jdW1lbnQgdGhlIHJlYWN0aXZlIGZ1bmN0aW9uIGRhdGEgc3RydWN0dXJlLFxuLy8gYW5kIGNvbnRhaW5zIGEgdXRpbGl0eSBmdW5jdGlvbiBmb3IgcGFyc2luZyB0aGUgb3B0aW9ucyBwYXNzZWQgdG8gbW9kZWwucmVhY3QoKS5cbmZ1bmN0aW9uIFJlYWN0aXZlRnVuY3Rpb24oaW5Qcm9wZXJ0aWVzLCBvdXRQcm9wZXJ0eSwgY2FsbGJhY2spe1xuICB2YXIgzrsgPSB7XG5cbiAgICAvLyBBbiBhcnJheSBvZiBpbnB1dCBwcm9wZXJ0eSBuYW1lcy5cbiAgICBpblByb3BlcnRpZXM6IGluUHJvcGVydGllcyxcblxuICAgIC8vIFRoZSBvdXRwdXQgcHJvcGVydHkgbmFtZS5cbiAgICBvdXRQcm9wZXJ0eTogb3V0UHJvcGVydHksXG5cbiAgICAvLyBmdW5jdGlvbiAoaW5Qcm9wZXJ0eVZhbHVlcykgLT4gb3V0UHJvcGVydHlWYWx1ZVxuICAgIC8vIEludm9rZWQgZHVyaW5nIGEgZGlnZXN0LFxuICAgIC8vICAgLSB3aGVuIGFsbCBpbnB1dCBwcm9wZXJ0eSB2YWx1ZXMgYXJlIGZpcnN0IGRlZmluZWQsXG4gICAgLy8gICAtIGluIHJlc3BvbnNlIHRvIGFueSBjaGFuZ2VzIGluIGlucHV0IHByb3BlcnR5IHZhbHVlcy5cbiAgICBjYWxsYmFjazogY2FsbGJhY2ssXG5cbiAgICAvLyBpbk5vZGVzIGFuZCBvdXROb2RlcyBhcmUgcG9wdWxhdGVkIGluIHRoZSBmdW5jdGlvbiByZWFjdGl2ZU1vZGVsLmFzc2lnbk5vZGVzKCksXG4gICAgLy8gd2hpY2ggaXMgaW52b2tlZCBhZnRlciB0aGUgb3JpZ2luYWwgUmVhY3RpdmVGdW5jdGlvbiBvYmplY3QgaXMgY3JlYXRlZC5cblxuICAgIC8vIEFuIGFycmF5IG9mIG5vZGUgaWQgc3RyaW5ncyBjb3JyZXNwb25kaW5nXG4gICAgLy8gdG8gdGhlIHByb3BlcnR5IG5hbWVzIGluIGluUHJvcGVydGllcy5cbiAgICBpbk5vZGVzOiB1bmRlZmluZWQsXG5cbiAgICAvLyBUaGUgbm9kZSBpZCBzdHJpbmcgY29ycmVzcG9uZGluZyB0byB0aGUgb3V0cHV0IHByb3BlcnR5LlxuICAgIG91dE5vZGU6IHVuZGVmaW5lZFxuICB9O1xuXG4gIHJldHVybiDOuztcbn1cblxuLy8gVGhpcyBmdW5jdGlvbiBwYXJzZXMgdGhlIG9wdGlvbnMgb2JqZWN0IHBhc3NlZCBpbnRvIGBtb2RlbC5yZWFjdChvcHRpb25zKWAsXG4vLyB0cmFuc2Zvcm1pbmcgaXQgaW50byBhbiBhcnJheSBvZiBSZWFjdGl2ZUZ1bmN0aW9uIGluc3RhbmNlcy5cblJlYWN0aXZlRnVuY3Rpb24ucGFyc2UgPSBmdW5jdGlvbiAob3B0aW9ucyl7XG4gIHJldHVybiBPYmplY3Qua2V5cyhvcHRpb25zKS5tYXAoZnVuY3Rpb24gKG91dFByb3BlcnR5KXtcbiAgICB2YXIgYXJyYXkgPSBvcHRpb25zW291dFByb3BlcnR5XTtcbiAgICB2YXIgY2FsbGJhY2sgPSBhcnJheS5zcGxpY2UoYXJyYXkubGVuZ3RoIC0gMSlbMF07XG4gICAgdmFyIGluUHJvcGVydGllcyA9IGFycmF5O1xuICAgIHJldHVybiBSZWFjdGl2ZUZ1bmN0aW9uKGluUHJvcGVydGllcywgb3V0UHJvcGVydHksIGNhbGxiYWNrKTtcbiAgfSk7XG59O1xuXG5leHBvcnQgZGVmYXVsdCBSZWFjdGl2ZUZ1bmN0aW9uO1xuIiwiLy8gVGhpcyBpcyB0aGUgdG9wLWxldmVsIG1vZHVsZSBleHBvcnRlZCBieSB0aGUgcmVhY3RpdmUtbW9kZWwgcGFja2FnZS5cbi8vIFRoZSBleHBvcnRlZCBmdW5jdGlvbiBpcyBhIGNvbnN0cnVjdG9yIGZvciByZWFjdGl2ZSBtb2RlbHNcbi8vIHRoYXQgYWxzbyBleHBvc2VzIHRoZSBkaWdlc3QoKSBmdW5jdGlvbiwgd2hpY2ggc3luY2hyb25vdXNseVxuLy8gZXZhbHVhdGVzIHRoZSBkYXRhIGRlcGVuZGVuY3kgZ3JhcGguXG5cbi8vIEJ5IEN1cnJhbiBLZWxsZWhlciBKdW5lIDIwMTVcblxuaW1wb3J0IEdyYXBoIGZyb20gXCIuL2dyYXBoXCI7XG5pbXBvcnQgUmVhY3RpdmVHcmFwaCBmcm9tIFwiLi9yZWFjdGl2ZUdyYXBoXCI7XG5pbXBvcnQgUmVhY3RpdmVGdW5jdGlvbiBmcm9tIFwiLi9yZWFjdGl2ZUZ1bmN0aW9uXCI7XG5cbnZhciByZWFjdGl2ZUdyYXBoID0gbmV3IFJlYWN0aXZlR3JhcGgoKTtcblxudmFyIGFkZFJlYWN0aXZlRnVuY3Rpb24gICAgICA9IHJlYWN0aXZlR3JhcGguYWRkUmVhY3RpdmVGdW5jdGlvbjtcbnZhciBtYWtlUHJvcGVydHlOb2RlICAgICAgICAgPSByZWFjdGl2ZUdyYXBoLm1ha2VQcm9wZXJ0eU5vZGU7XG52YXIgbWFrZVJlYWN0aXZlRnVuY3Rpb25Ob2RlID0gcmVhY3RpdmVHcmFwaC5tYWtlUmVhY3RpdmVGdW5jdGlvbk5vZGU7XG52YXIgcHJvcGVydHlOb2RlRGlkQ2hhbmdlICAgID0gcmVhY3RpdmVHcmFwaC5wcm9wZXJ0eU5vZGVEaWRDaGFuZ2U7XG5cbmZ1bmN0aW9uIFJlYWN0aXZlTW9kZWwoKXtcbiAgXG4gIC8vIEVuZm9yY2UgdXNlIG9mIG5ldywgc28gaW5zdGFuY2VvZiBhbmQgdHlwZW9mIGNoZWNrcyB3aWxsIGFsd2F5cyB3b3JrLlxuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgUmVhY3RpdmVNb2RlbCkpIHtcbiAgICByZXR1cm4gbmV3IFJlYWN0aXZlTW9kZWwoKTtcbiAgfVxuXG4gIC8vIFJlZmVyIHRvIGB0aGlzYCAodGhlIFJlYWN0aXZlTW9kZWwgaW5zdGFuY2UpIGFzIGBtb2RlbGAgaW4gdGhpcyBjbG9zdXJlLlxuICB2YXIgbW9kZWwgPSB0aGlzO1xuXG4gIC8vIHsgcHJvcGVydHkgLT4gZGVmYXVsdFZhbHVlIH1cbiAgdmFyIHB1YmxpY1Byb3BlcnRpZXMgPSB7fTtcblxuICAvLyB7IHByb3BlcnR5IC0+IHZhbHVlIH1cbiAgdmFyIHZhbHVlcyA9IHt9O1xuXG4gIC8vIHsgcHJvcGVydHkgLT4gbm9kZSB9XG4gIHZhciB0cmFja2VkUHJvcGVydGllcyA9IHt9O1xuXG4gIHZhciBpc0ZpbmFsaXplZCA9IGZhbHNlO1xuXG4gIGZ1bmN0aW9uIGFkZFB1YmxpY1Byb3BlcnR5KHByb3BlcnR5LCBkZWZhdWx0VmFsdWUpe1xuICAgIGlmKGlzRmluYWxpemVkKXtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIm1vZGVsLmFkZFB1YmxpY1Byb3BlcnR5KCkgaXMgYmVpbmcgXCIgK1xuICAgICAgICBcImludm9rZWQgYWZ0ZXIgbW9kZWwuZmluYWxpemUsIGJ1dCB0aGlzIGlzIG5vdCBhbGxvd2VkLiBcIitcbiAgICAgICAgXCJQdWJsaWMgcHJvcGVydGllcyBtYXkgb25seSBiZSBhZGRlZCBiZWZvcmUgdGhlIG1vZGVsIGlzIGZpbmFsaXplZC5cIik7XG4gICAgfVxuXG4gICAgLy8gVE9ETyB0ZXN0IHRoaXNcbiAgICAvLyBpZihpc0RlZmluZWQoZGVmYXVsdFZhbHVlKSl7XG4gICAgLy8gIHRocm93IG5ldyBFcnJvcihcIm1vZGVsLmFkZFB1YmxpY1Byb3BlcnR5KCkgaXMgYmVpbmcgXCIgK1xuICAgIC8vICAgIFwiaW52b2tlZCB3aXRoIGFuIHVuZGVmaW5lZCBkZWZhdWx0IHZhbHVlLiBEZWZhdWx0IHZhbHVlcyBmb3IgcHVibGljIHByb3BlcnRpZXMgXCIgK1xuICAgIC8vICAgIFwibXVzdCBiZSBkZWZpbmVkLCB0byBndWFyYW50ZWUgcHJlZGljdGFibGUgYmVoYXZpb3IuIEZvciBwdWJsaWMgcHJvcGVydGllcyB0aGF0IFwiICtcbiAgICAvLyAgICBcImFyZSBvcHRpb25hbCBhbmQgc2hvdWxkIGhhdmUgdGhlIHNlbWFudGljcyBvZiBhbiB1bmRlZmluZWQgdmFsdWUsIFwiICtcbiAgICAvLyAgICBcInVzZSBSZWFjdGl2ZU1vZGVsLk5PTkUgYXMgdGhlIGRlZmF1bHQgdmFsdWUuXCIpO1xuICAgIC8vfVxuXG4gICAgcHVibGljUHJvcGVydGllc1twcm9wZXJ0eV0gPSBkZWZhdWx0VmFsdWU7XG5cbiAgICByZXR1cm4gbW9kZWw7XG4gIH1cblxuICBmdW5jdGlvbiBnZXREZWZhdWx0VmFsdWUocHJvcGVydHkpe1xuICAgIHJldHVybiBwdWJsaWNQcm9wZXJ0aWVzW3Byb3BlcnR5XTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGZpbmFsaXplKCl7XG4gICAgaWYoaXNGaW5hbGl6ZWQpe1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwibW9kZWwuZmluYWxpemUoKSBpcyBiZWluZyBpbnZva2VkIFwiICtcbiAgICAgICAgXCJtb3JlIHRoYW4gb25jZSwgYnV0IHRoaXMgZnVuY3Rpb24gc2hvdWxkIG9ubHkgYmUgaW52b2tlZCBvbmNlLlwiKTtcbiAgICB9XG4gICAgaXNGaW5hbGl6ZWQgPSB0cnVlO1xuXG4gICAgT2JqZWN0LmtleXMocHVibGljUHJvcGVydGllcykuZm9yRWFjaChmdW5jdGlvbihwcm9wZXJ0eSl7XG4gICAgICB0cmFjayhwcm9wZXJ0eSk7XG4gICAgICBtb2RlbFtwcm9wZXJ0eV0oZ2V0RGVmYXVsdFZhbHVlKHByb3BlcnR5KSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gbW9kZWw7XG4gIH1cblxuICBmdW5jdGlvbiBnZXRTdGF0ZSgpe1xuICAgIHZhciBzdGF0ZSA9IHt9O1xuICAgIE9iamVjdC5rZXlzKHB1YmxpY1Byb3BlcnRpZXMpLmZvckVhY2goIGZ1bmN0aW9uIChwdWJsaWNQcm9wZXJ0eSl7XG4gICAgICBzdGF0ZVtwdWJsaWNQcm9wZXJ0eV0gPSB2YWx1ZXNbcHVibGljUHJvcGVydHldO1xuICAgIH0pO1xuICAgIHJldHVybiBzdGF0ZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHNldFN0YXRlKHN0YXRlKXtcblxuICAgIC8vIFRPRE8gdGhyb3cgYW4gZXJyb3IgaWYgc29tZSBwcm9wZXJ0eSBpbiBzdGF0ZVxuICAgIC8vIGlzIG5vdCBpbiBwdWJsaWNQcm9wZXJ0aWVzXG4gICAgLy9PYmplY3Qua2V5cyhzdGF0ZSkuZm9yRWFjaChmdW5jdGlvbiAocHJvcGVydHkpe1xuICAgIC8vICBpZighcHJvcGVydHkgaW4gcHVibGljUHJvcGVydGllcyl7XG4gICAgLy8gICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0ZW1wdGluZyB0byBzZXQgYSBwcm9wZXJ0eSB0aGF0IGhhcyBub3RcIiArXG4gICAgLy8gICAgICBcIiBiZWVuIGFkZGVkIGFzIGEgcHVibGljIHByb3BlcnR5IGluIG1vZGVsLnNldFN0YXRlKClcIik7XG4gICAgLy8gIH1cbiAgICAvL30pO1xuXG4gICAgLy8gUmVzZXQgc3RhdGUgdG8gZGVmYXVsdCB2YWx1ZXMuXG4gICAgT2JqZWN0LmtleXMocHVibGljUHJvcGVydGllcykuZm9yRWFjaChmdW5jdGlvbiAocHJvcGVydHkpe1xuICAgICAgdmFyIGRlZmF1bHRWYWx1ZSA9IHB1YmxpY1Byb3BlcnRpZXNbcHJvcGVydHldO1xuICAgICAgbW9kZWxbcHJvcGVydHldKGRlZmF1bHRWYWx1ZSk7XG4gICAgfSk7XG5cbiAgICAvLyBBcHBseSB2YWx1ZXMgaW5jbHVkZWQgaW4gdGhlIG5ldyBzdGF0ZS5cbiAgICBPYmplY3Qua2V5cyhzdGF0ZSkuZm9yRWFjaChmdW5jdGlvbiAocHJvcGVydHkpe1xuICAgICAgdmFyIG5ld1ZhbHVlID0gc3RhdGVbcHJvcGVydHldXG4gICAgICBtb2RlbFtwcm9wZXJ0eV0obmV3VmFsdWUpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIG1vZGVsO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVhY3Qob3B0aW9ucyl7XG4gICAgUmVhY3RpdmVGdW5jdGlvbi5wYXJzZShvcHRpb25zKS5mb3JFYWNoKGZ1bmN0aW9uICjOuyl7XG4gICAgICBhc3NpZ25Ob2RlcyjOuyk7XG4gICAgICBhZGRSZWFjdGl2ZUZ1bmN0aW9uKM67KTtcbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGFzc2lnbk5vZGVzKM67KXtcbiAgICDOuy5pbk5vZGVzID0gzrsuaW5Qcm9wZXJ0aWVzLm1hcCh0cmFjayk7XG4gICAgzrsubm9kZSA9IG1ha2VSZWFjdGl2ZUZ1bmN0aW9uTm9kZSjOuyk7XG4gICAgzrsub3V0Tm9kZSA9IHRyYWNrKM67Lm91dFByb3BlcnR5KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRyYWNrKHByb3BlcnR5KXtcbiAgICBpZihwcm9wZXJ0eSBpbiB0cmFja2VkUHJvcGVydGllcyl7XG4gICAgICByZXR1cm4gdHJhY2tlZFByb3BlcnRpZXNbcHJvcGVydHldO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgZ2V0dGVyU2V0dGVyID0gY3JlYXRlR2V0dGVyU2V0dGVyKHByb3BlcnR5KTtcbiAgICAgIHZhciBwcm9wZXJ0eU5vZGUgPSBtYWtlUHJvcGVydHlOb2RlKGdldHRlclNldHRlcik7XG4gICAgICBtb2RlbFtwcm9wZXJ0eV0gPSBnZXR0ZXJTZXR0ZXI7XG4gICAgICB0cmFja2VkUHJvcGVydGllc1twcm9wZXJ0eV0gPSBwcm9wZXJ0eU5vZGU7XG4gICAgICByZXR1cm4gcHJvcGVydHlOb2RlO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGNyZWF0ZUdldHRlclNldHRlcihwcm9wZXJ0eSl7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICh2YWx1ZSl7XG4gICAgICBpZiAoIWFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlc1twcm9wZXJ0eV07XG4gICAgICB9XG4gICAgICB2YWx1ZXNbcHJvcGVydHldID0gdmFsdWU7XG4gICAgICBwcm9wZXJ0eURpZENoYW5nZShwcm9wZXJ0eSk7XG4gICAgICByZXR1cm4gbW9kZWw7XG4gICAgfTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHByb3BlcnR5RGlkQ2hhbmdlKHByb3BlcnR5KXtcbiAgICB2YXIgcHJvcGVydHlOb2RlID0gdHJhY2tlZFByb3BlcnRpZXNbcHJvcGVydHldO1xuICAgIHByb3BlcnR5Tm9kZURpZENoYW5nZShwcm9wZXJ0eU5vZGUpO1xuICB9XG5cbiAgbW9kZWwuYWRkUHVibGljUHJvcGVydHkgPSBhZGRQdWJsaWNQcm9wZXJ0eTtcbiAgbW9kZWwuZmluYWxpemUgPSBmaW5hbGl6ZTtcbiAgbW9kZWwuZ2V0U3RhdGUgPSBnZXRTdGF0ZTtcbiAgbW9kZWwuc2V0U3RhdGUgPSBzZXRTdGF0ZTtcbiAgbW9kZWwucmVhY3QgPSByZWFjdDtcbn1cblxuUmVhY3RpdmVNb2RlbC5kaWdlc3QgPSByZWFjdGl2ZUdyYXBoLmRpZ2VzdDtcblxuLy8gRXhwb3J0IHRoZXNlIGludGVybmFsIG1vZHVsZXMgZm9yIHVuaXQgdGVzdGluZyB2aWEgUm9sbHVwIENvbW1vbkpTIGJ1aWxkLlxuUmVhY3RpdmVNb2RlbC5HcmFwaCA9IEdyYXBoO1xuUmVhY3RpdmVNb2RlbC5SZWFjdGl2ZUdyYXBoID0gUmVhY3RpdmVHcmFwaDtcblJlYWN0aXZlTW9kZWwuUmVhY3RpdmVGdW5jdGlvbiA9IFJlYWN0aXZlRnVuY3Rpb247XG5cbmV4cG9ydCBkZWZhdWx0IFJlYWN0aXZlTW9kZWw7XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBLEVBQ0EsU0FBUyxLQUFLLEVBQUU7QUFEaEIsRUFFQTtBQUZBLEVBR0E7QUFIQSxFQUlBO0FBSkEsRUFLQTtBQUxBLEVBTUEsRUFBRSxJQUFJLEtBQUssR0FBRyxFQUFFOztBQU5oQixFQVFBO0FBUkEsRUFTQSxFQUFFLFNBQVMsUUFBUSxDQUFDLENBQUMsQ0FBQztBQVR0QixFQVVBLElBQUksT0FBTyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQVZ0QyxFQVdBOztBQVhBLEVBYUEsRUFBRSxTQUFTLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBYnhCLEVBY0EsSUFBSSxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztBQWR2QixFQWVBOztBQWZBLEVBaUJBO0FBakJBLEVBa0JBO0FBbEJBLEVBbUJBO0FBbkJBLEVBb0JBO0FBcEJBLEVBcUJBO0FBckJBLEVBc0JBO0FBdEJBLEVBdUJBOztBQXZCQSxFQXlCQTtBQXpCQSxFQTBCQTtBQTFCQSxFQTJCQSxFQUFFLFNBQVMsR0FBRyxDQUFDLFdBQVcsRUFBRSxXQUFXLENBQUM7O0FBM0J4QyxFQTZCQSxJQUFJLElBQUksT0FBTyxHQUFHLEVBQUU7QUE3QnBCLEVBOEJBLElBQUksSUFBSSxLQUFLLEdBQUcsRUFBRTs7QUE5QmxCLEVBZ0NBLElBQUksR0FBRyxDQUFDLFdBQVcsQ0FBQztBQWhDcEIsRUFpQ0EsTUFBTSxXQUFXLEdBQUcsVUFBVSxJ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