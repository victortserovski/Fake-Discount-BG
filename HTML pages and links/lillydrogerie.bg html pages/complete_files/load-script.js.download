const loadScript = (path, type) => {
    return new Promise((resolve, reject) => {
      if (!document.querySelector(`head script[src="${path}"]`)) {
        let script = document.createElement("script");
        script.src = path;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      } else {
        setTimeout(() => {
          resolve();
        }, 500);
      }
    });
  };
  